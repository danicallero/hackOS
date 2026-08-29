import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import {
  type AccountRemovalAction,
  removalVenueState,
  runAccountRemoval,
} from "../identity/removal.js";
import { broadcastForActiveUsers } from "./active-broadcast.js";

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
 * event_ends_at are left alone (staff activity during teardown). Pending
 * removals can finalize from this system-generated exit; expired H24
 * certainty windows can also finalize without inventing a door scan.
 */

const QUEUE_NAME = "presence-event-end-closer";

async function finalizePendingRemoval(
  userId: number,
  action: AccountRemovalAction,
): Promise<boolean> {
  try {
    const result = await runAccountRemoval({
      targetId: userId,
      actorId: null,
      source: "presence_exit_completion",
      requestedAction: action,
    });
    return result.status === "completed";
  } catch {
    // The pending row remains inaccessible and all writers remain blocked;
    // the next closer tick can safely retry it.
    return false;
  }
}

export async function runPresenceEventEndCloserOnce(): Promise<{
  closed: number[];
  finalized: number[];
}> {
  const { closed, pending } = await withTransaction(async (client) => {
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
          AND (
            u.account_state = 'active'
            OR (u.account_state = 'removal_pending' AND u.removal_requires_exit = true)
          )
          AND u.anonymized_at IS NULL
        ORDER BY tl.user_id, tl.scanned_at DESC, tl.id DESC`,
    );

    const closedIds: number[] = [];
    const pendingIds: Array<{ userId: number; action: AccountRemovalAction }> = [];
    for (const candidate of candidates) {
      const active = await client.query<{ id: number }>(
        `SELECT id
           FROM users
          WHERE id = $1
            AND (
              account_state = 'active'
              OR (account_state = 'removal_pending' AND removal_requires_exit = true)
            )
            AND anonymized_at IS NULL
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
      const { rows: stateRows } = await client.query<{
        account_state: "active" | "removal_pending";
        removal_action: AccountRemovalAction | null;
      }>(`SELECT account_state, removal_action FROM users WHERE id = $1`, [candidate.user_id]);
      const state = stateRows[0];
      if (state?.account_state === "removal_pending" && state.removal_action) {
        pendingIds.push({ userId: candidate.user_id, action: state.removal_action });
      }
      await audit(client, {
        actorId: null,
        entityType: "presence",
        entityId: candidate.user_id,
        action: "event_end_auto_exit",
        after: { kind: "out", scannedAt: candidate.event_ends_at },
      });
    }

    // The raw H24 session can remain open after its latest certainty window
    // expires, even though the accrued presence calculation has invalidated
    // that provisional sum. Treat that as a valid removal exit and let the
    // normal finalizer perform the irreversible scrub.
    const { rows: pendingRows } = await client.query<{
      id: number;
      removal_action: AccountRemovalAction;
    }>(
      `SELECT id, removal_action
         FROM users
        WHERE account_state = 'removal_pending'
          AND removal_requires_exit = true
          AND anonymized_at IS NULL
        FOR UPDATE`,
    );
    for (const row of pendingRows) {
      const venue = await removalVenueState(client, row.id);
      if (!venue.requiresExit) {
        await client.query(`UPDATE users SET removal_requires_exit = false WHERE id = $1`, [
          row.id,
        ]);
        if (!pendingIds.some((pendingRow) => pendingRow.userId === row.id)) {
          pendingIds.push({ userId: row.id, action: row.removal_action });
        }
      }
    }

    // The participant may cancel only until the fixed recovery deadline that
    // was captured with the initiating session. Once it expires, finalize the
    // accepted anonymization even if an open raw door session was never
    // reconciled; no later sign-in may extend this deadline.
    const { rows: expiredRemovalRows } = await client.query<{
      id: number;
      removal_action: AccountRemovalAction;
    }>(
      `SELECT id, removal_action
         FROM users
        WHERE account_state = 'removal_pending'
          AND removal_expires_at IS NOT NULL
          AND removal_expires_at <= clock_timestamp()
          AND anonymized_at IS NULL
        FOR UPDATE`,
    );
    for (const row of expiredRemovalRows) {
      if (!pendingIds.some((pendingRow) => pendingRow.userId === row.id)) {
        pendingIds.push({ userId: row.id, action: row.removal_action });
      }
    }
    return { closed: closedIds, pending: pendingIds };
  });
  const finalized: number[] = [];
  for (const row of pending) {
    if (await finalizePendingRemoval(row.userId, row.action)) finalized.push(row.userId);
  }
  if (closed.length > 0) {
    await broadcastForActiveUsers(
      closed,
      SSE_TOPICS.LOGISTICS,
      EVENTS.LOGISTICS_PRESENCE_SCAN,
      (activeUserIds) => ({
        autoEventEndExit: true,
        userIds: activeUserIds,
      }),
    );
  }
  return { closed, finalized };
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
