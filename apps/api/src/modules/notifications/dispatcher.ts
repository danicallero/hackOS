import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { dispatchChannel, type OutboxRow } from "./channels/index.js";
import { PermanentDispatchError, SupersededDispatchError } from "./errors.js";

/**
 * Outbox dispatcher (H52, plan/07 §5.4). A repeatable BullMQ job claims due
 * `notification_outbox` rows and hands each to its channel adapter. "Due" =
 * status queued AND next_attempt_at <= now(). `FOR UPDATE SKIP LOCKED`
 * inside one transaction is what makes running several worker processes safe
 * — a row locked by one drain is invisible to a concurrent drain rather than
 * blocking it, so nothing is ever sent twice.
 *
 * Outcomes per row:
 *   - success            -> status='sent', sent_at=now()
 *   - failure, attempts < MAX_ATTEMPTS -> attempts++, last_error set,
 *     next_attempt_at pushed out by exponential backoff (never touches status)
 *   - failure, attempts reaches MAX_ATTEMPTS, OR a PermanentDispatchError
 *     -> status='failed' — parked, never deleted, always visible via
 *     last_error for the admin/audit surface.
 *   - a SupersededDispatchError (H51/H52: the queue transition it describes
 *     is no longer current) -> status='superseded' immediately, no retry —
 *     this is not a failure, sending it would just be stale/duplicate noise.
 */

const QUEUE_NAME = "notifications-outbox";
const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 30_000; // 30s
const MAX_DELAY_MS = 30 * 60_000; // 30min cap

export function backoffDelayMs(attempts: number): number {
  const delay = BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  parked: number;
  superseded: number;
}

type RowOutcome = "sent" | "failed" | "parked" | "superseded";

/**
 * Claim and dispatch exactly one due row, in its own transaction. Committing
 * per row (rather than batching the whole tick into one transaction) bounds
 * the duplicate-send window to at most this single in-flight row if the
 * process dies mid-dispatch — that window exists at any batch size, but it
 * doesn't grow with it, which matters once `NOTIFICATION_OUTBOX_BATCH_SIZE`
 * is raised for a mass-send (docs/big-event-readiness.md): a crash no longer
 * risks re-sending everything already committed earlier in the same tick.
 */
async function claimAndDispatchOne(): Promise<RowOutcome | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, category, channel, payload, attempts, created_at
       FROM notification_outbox
       WHERE status = 'queued' AND next_attempt_at <= now()
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const row = rows[0] as OutboxRow | undefined;
    if (!row) return null;

    try {
      await dispatchChannel(client, row);
      await client.query(
        `UPDATE notification_outbox SET status = 'sent', sent_at = now() WHERE id = $1`,
        [row.id],
      );
      return "sent";
    } catch (err) {
      if (err instanceof SupersededDispatchError) {
        await client.query(
          `UPDATE notification_outbox
           SET status = 'superseded', attempts = $2, last_error = $3
           WHERE id = $1`,
          [row.id, row.attempts + 1, err.message],
        );
        return "superseded";
      }
      const message = err instanceof Error ? err.message : String(err);
      const attempts = row.attempts + 1;
      const permanent = err instanceof PermanentDispatchError;
      if (permanent || attempts >= MAX_ATTEMPTS) {
        await client.query(
          `UPDATE notification_outbox
           SET status = 'failed', attempts = $2, last_error = $3
           WHERE id = $1`,
          [row.id, attempts, message],
        );
        return "parked";
      }
      const delayMs = backoffDelayMs(attempts);
      await client.query(
        `UPDATE notification_outbox
         SET attempts = $2, last_error = $3, next_attempt_at = now() + make_interval(secs => $4)
         WHERE id = $1`,
        [row.id, attempts, message, delayMs / 1000],
      );
      return "failed";
    }
  });
}

/** One claim-and-dispatch pass. Exported so tests can invoke it directly instead of waiting on BullMQ repeat timing. */
export async function drainOutboxOnce(batchSize = 100): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0, parked: 0, superseded: 0 };

  for (let i = 0; i < batchSize; i += 1) {
    const outcome = await claimAndDispatchOne();
    if (!outcome) break;
    result.claimed += 1;
    result[outcome] += 1;
  }

  return result;
}

registerWorker(QUEUE_NAME, async () => {
  await drainOutboxOnce(config.NOTIFICATION_OUTBOX_BATCH_SIZE);
});

/** Schedules the recurring drain. Skipped in tests, which drive drainOutboxOnce() directly. */
export async function scheduleOutboxDispatcher(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 5_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
