import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { broadcast } from "../../lib/sse.js";

/**
 * Event-end automatic exit (H24, product override of the original "the
 * system never closes a session itself" stance): once
 * event_config.event_ends_at passes, every door session still open gets a
 * final `out` at exactly event_ends_at, with scanned_by NULL (system actor,
 * migration 0708) and an audit row per person. The estimator is unaffected
 * when the session's certainty window already expired — an `out` outside the
 * window credits nothing — so this only restores the raw session invariant
 * (in/out alternation) and stops the reconciliation list from filling up
 * with sessions nobody will ever close by hand.
 *
 * Idempotent by construction: after the insert, the person's latest door log
 * is an `out`, so the next run selects nobody. Sessions opened *after*
 * event_ends_at are left alone (staff activity during teardown).
 */

const QUEUE_NAME = "presence-event-end-closer";

export async function runPresenceEventEndCloserOnce(): Promise<{ closed: number[] }> {
  const closed = await withTransaction(async (client) => {
    // Do not keep a set-based candidate snapshot until the insert. Account
    // removal locks the same user row and moves it to removal_pending before
    // any identity-bearing records are scrubbed. Lock and re-check each
    // candidate so a concurrent removal simply makes this participant a
    // no-op, rather than aborting the entire event-end closer transaction.
    const { rows: candidates } = await client.query<{
      user_id: number;
      event_ends_at: Date;
    }>(
      `SELECT DISTINCT ON (tl.user_id) tl.user_id, ec.event_ends_at
         FROM event_config ec
         JOIN time_logs tl ON tl.scanned_at <= now()
         JOIN users u ON u.id = tl.user_id
        WHERE ec.id = 1 AND ec.event_ends_at IS NOT NULL AND ec.event_ends_at <= now()
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
        ORDER BY tl.user_id, tl.scanned_at DESC, tl.id DESC`,
    );

    const closedIds: number[] = [];
    for (const candidate of candidates) {
      const active = await client.query<{ id: number }>(
        `SELECT id
           FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
          FOR UPDATE`,
        [candidate.user_id],
      );
      if (active.rowCount === 0) continue;

      const { rows: latestRows } = await client.query<{
        kind: string;
        scanned_at: Date;
      }>(
        `SELECT kind, scanned_at
           FROM time_logs
          WHERE user_id = $1
          ORDER BY scanned_at DESC, id DESC
          LIMIT 1`,
        [candidate.user_id],
      );
      const latest = latestRows[0];
      if (latest?.kind !== "in" || latest.scanned_at > candidate.event_ends_at) {
        continue;
      }

      await client.query(
        `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by, notes)
         VALUES ($1, 'out', $2, NULL, 'Automatic exit at event end')`,
        [candidate.user_id, candidate.event_ends_at],
      );
      closedIds.push(candidate.user_id);
      await audit(client, {
        actorId: null,
        entityType: "presence",
        entityId: candidate.user_id,
        action: "event_end_auto_exit",
        after: { kind: "out", scannedAt: candidate.event_ends_at },
      });
    }
    return closedIds;
  });
  if (closed.length > 0) {
    await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_PRESENCE_SCAN, {
      autoEventEndExit: true,
      userIds: closed,
    });
  }
  return { closed };
}

registerWorker(QUEUE_NAME, async () => {
  await runPresenceEventEndCloserOnce();
});

export async function schedulePresenceEventEndCloser(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 60_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
