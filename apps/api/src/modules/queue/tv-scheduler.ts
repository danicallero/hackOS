import { config } from "../../config.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { clearTvOverride, getTvOverride, publishTvStateIfChanged } from "./tv.js";

/**
 * H42: keeps the fleet on whatever it should be showing without a human.
 * Two jobs, both on the same tick:
 *
 *  - **override expiry** — a mode broadcast with an expiresAt (announcement,
 *    wifi, timer…) is dropped once it's due, handing the screens back to the
 *    timetable rather than needing someone to remember;
 *  - **slot boundaries** — when a tv_slots window opens or closes, the newly
 *    effective state is broadcast so every screen follows along.
 *
 * Mirrors logistics/schedule-publisher.ts: a repeatable job polls and acts.
 * Broadcasting is change-gated (publishTvStateIfChanged), so a quiet tick is
 * silent rather than waking every connected screen every 5 seconds.
 */

const QUEUE_NAME = "tv-scheduler";

export async function runTvSchedulerOnce(): Promise<{ reverted: boolean; changed: boolean }> {
  const override = await getTvOverride();
  const due = Boolean(override?.expiresAt && new Date(override.expiresAt).getTime() <= Date.now());
  if (due) {
    // Broadcasts on its own, and lands wherever the timetable now points.
    await clearTvOverride();
    return { reverted: true, changed: true };
  }
  const { changed } = await publishTvStateIfChanged();
  return { reverted: false, changed };
}

registerWorker(QUEUE_NAME, async () => {
  await runTvSchedulerOnce();
});

export async function scheduleTvScheduler(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 5_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
