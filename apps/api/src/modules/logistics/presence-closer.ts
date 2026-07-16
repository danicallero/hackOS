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
    const { rows } = await client.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by, notes)
       SELECT last.user_id, 'out', ec.event_ends_at, NULL, 'Automatic exit at event end'
         FROM event_config ec
         JOIN (
           SELECT DISTINCT ON (user_id) user_id, kind, scanned_at
             FROM time_logs
            ORDER BY user_id, scanned_at DESC, id DESC
         ) last ON last.kind = 'in' AND last.scanned_at <= ec.event_ends_at
        WHERE ec.id = 1 AND ec.event_ends_at IS NOT NULL AND ec.event_ends_at <= now()
        RETURNING user_id, scanned_at`,
    );
    for (const row of rows as { user_id: number; scanned_at: Date }[]) {
      await audit(client, {
        actorId: null,
        entityType: "presence",
        entityId: row.user_id,
        action: "event_end_auto_exit",
        after: { kind: "out", scannedAt: row.scanned_at },
      });
    }
    return (rows as { user_id: number }[]).map((row) => row.user_id);
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
