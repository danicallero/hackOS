import { getQueue } from "../../lib/queues.js";

/**
 * Early Live Activity tick (#966) after a change that can start, update or
 * end Live Activities: a queue transition, call or deletion (H29, H38), the
 * judging window, a schedule or activity edit (H25, H59), an event timing
 * edit (H19, H22), a configuration save. Separate from worker.ts so domain modules enqueue it without
 * importing the worker (which imports them).
 */

export const LIVE_ACTIVITIES_QUEUE = "live-activities";
export const LIVE_ACTIVITIES_KICK_JOB = "kick";
/**
 * The first request schedules one tick this long after it; requests inside
 * the window join it, and a request after it schedules the next one, so a
 * change made while a tick runs is never lost. The delay also lets the
 * caller's transaction commit.
 */
export const LIVE_ACTIVITIES_KICK_DEBOUNCE_MS = 2_000;

/**
 * Best effort: a failure is logged, never surfaced, since the repeatable
 * tick converges anyway.
 */
export async function requestLiveActivitySync(): Promise<void> {
  try {
    await getQueue(LIVE_ACTIVITIES_QUEUE).add(
      LIVE_ACTIVITIES_KICK_JOB,
      {},
      {
        delay: LIVE_ACTIVITIES_KICK_DEBOUNCE_MS,
        deduplication: {
          id: `${LIVE_ACTIVITIES_QUEUE}-${LIVE_ACTIVITIES_KICK_JOB}`,
          ttl: LIVE_ACTIVITIES_KICK_DEBOUNCE_MS,
        },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch (err) {
    console.warn("live-activities: could not schedule an early sync", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
