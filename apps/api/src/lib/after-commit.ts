import { config } from "../config.js";

/**
 * Run a realtime/notification side effect after the domain transaction has
 * committed, without making the user's response wait on it (Valkey publish,
 * BullMQ enqueue, Live Activity kick). Failures are logged, never surfaced:
 * the committed write is the source of truth and clients converge through
 * their SSE resync/poll fallback.
 *
 * Under test the effect is awaited so integration assertions observe it
 * deterministically (same contract as `scheduleTopUp`).
 */
export async function afterCommit(label: string, effect: () => Promise<unknown>): Promise<void> {
  const done = Promise.resolve()
    .then(effect)
    .catch((err) => {
      console.error(`[after-commit] ${label} failed`, err);
    });
  if (config.isTest) await done;
}
