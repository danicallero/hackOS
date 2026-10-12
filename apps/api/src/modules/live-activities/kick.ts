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
export const LIVE_ACTIVITIES_BOUNDARY_JOB = "boundary";
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

/**
 * A tick lands just after a staff or attendee activity starts or ends (H25,
 * H26, H59), so the phase change goes out on time instead of on the next
 * 20 s repetition. The margin keeps the tick's clock past the instant.
 */
export const LIVE_ACTIVITIES_BOUNDARY_MARGIN_MS = 500;

/** BullMQ job id of the boundary tick for an instant: one job per instant. */
export function liveActivityBoundaryJobId(at: Date): string {
  return `${LIVE_ACTIVITIES_QUEUE}-${LIVE_ACTIVITIES_BOUNDARY_JOB}-${at.getTime()}`;
}

/**
 * Schedules one tick at each instant (deduplicated by job id, so every tick
 * can request the same boundaries again). Best effort like
 * `requestLiveActivitySync`.
 */
export async function scheduleLiveActivityBoundaries(instants: Date[]): Promise<void> {
  for (const at of instants) {
    try {
      await getQueue(LIVE_ACTIVITIES_QUEUE).add(
        LIVE_ACTIVITIES_BOUNDARY_JOB,
        {},
        {
          delay: Math.max(0, at.getTime() - Date.now()) + LIVE_ACTIVITIES_BOUNDARY_MARGIN_MS,
          jobId: liveActivityBoundaryJobId(at),
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      console.warn("live-activities: could not schedule a boundary tick", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
