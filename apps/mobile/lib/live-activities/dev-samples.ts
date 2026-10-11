import {
  type ActivityLiveProps,
  activityLiveActivitySubject,
  activityLiveLabels,
  QUEUE_LIVE_ACTIVITY_SUBJECT,
  type QueueLiveProps,
  queueLiveLabels,
} from "@hackos/shared/live-activities";
import { applyDesiredActivities, endAllActivities } from "./apply";
import type { DesiredActivity } from "./model";

/**
 * DEVELOPMENT ONLY (#966). `hackos://dev/live-activity?sample=<name>` shows
 * sample Live Activities without a backend, for simulator review and
 * screenshots. Only reachable through `app/+native-intent.tsx` behind
 * `__DEV__`, so production bundles drop this module entirely.
 *
 * Samples: queue-waiting, queue-called, staff-upcoming, staff-live, all; `end` removes them.
 */
const MINUTE = 60_000;

function queue(phase: QueueLiveProps["phase"]): DesiredActivity {
  const called = phase !== "waiting";
  return {
    kind: "queue",
    subject: QUEUE_LIVE_ACTIVITY_SUBJECT,
    props: {
      v: 1,
      kind: "queue",
      phase,
      entryId: 1,
      challengeTitle: "Best use of open data",
      position: called ? null : 4,
      etaMinutes: called ? null : 12,
      roomName: called ? "Room B" : null,
      roomLocation: called ? "Floor 1, east wing" : null,
      otherQueues: 2,
      url: "hackos://queue",
      labels: queueLiveLabels("en", 2),
      updatedAt: new Date().toISOString(),
    },
  };
}

function staff(phase: ActivityLiveProps["phase"]): DesiredActivity {
  const now = Date.now();
  const startsAt = phase === "upcoming" ? now + 18 * MINUTE : now - 25 * MINUTE;
  return {
    kind: "activity",
    subject: activityLiveActivitySubject(7),
    props: {
      v: 1,
      kind: "activity",
      phase,
      activityId: 7,
      name: "Lunch",
      category: "meal",
      location: "Cafeteria",
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 90 * MINUTE).toISOString(),
      scanned: phase === "live" ? 142 : 0,
      scanUrl: "hackos://scan?activity=7",
      url: "hackos://scan?activity=7",
      labels: activityLiveLabels("en"),
      updatedAt: new Date(now).toISOString(),
    },
  };
}

const SAMPLES: Record<string, () => DesiredActivity[]> = {
  "queue-waiting": () => [queue("waiting")],
  "queue-called": () => [queue("called")],
  "staff-upcoming": () => [staff("upcoming")],
  "staff-live": () => [staff("live")],
  all: () => [queue("waiting"), staff("live")],
};

/** Returns the route to land on when `path` was a sample link, else null. */
export function handleDevLiveActivityLink(path: string): string | null {
  const match = /^(?:hackos:)?\/*dev\/live-activity\?sample=([a-z-]+)/i.exec(path.trim());
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  if (name === "end") {
    void endAllActivities();
    return "/";
  }
  const sample = SAMPLES[name];
  if (sample) void applyDesiredActivities(sample()).catch(() => undefined);
  return "/";
}
