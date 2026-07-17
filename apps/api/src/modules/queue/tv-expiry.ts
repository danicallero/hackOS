import { config } from "../../config.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { getTvMode, revertTvModeToDefault } from "./tv.js";

/**
 * H42 "automatic expiry": an admin can put a mode (announcement, wifi,
 * timer…) live with an expiresAt so it doesn't need a human to remember to
 * switch the fleet back to the rooms view. Mirrors
 * logistics/schedule-publisher.ts: repeatable job polls the ephemeral state
 * and reverts once it's due.
 */

const QUEUE_NAME = "tv-mode-expiry";

export async function runTvExpiryPublisherOnce(): Promise<{ reverted: boolean }> {
  const current = await getTvMode();
  if (!current.expiresAt || new Date(current.expiresAt).getTime() > Date.now()) {
    return { reverted: false };
  }
  await revertTvModeToDefault();
  return { reverted: true };
}

registerWorker(QUEUE_NAME, async () => {
  await runTvExpiryPublisherOnce();
});

export async function scheduleTvExpiryPublisher(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 5_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
