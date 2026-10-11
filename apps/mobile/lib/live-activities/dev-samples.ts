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
 * Samples: queue-waiting, queue-estimating, queue-called, queue-in-room,
 * staff-upcoming, staff-live (a meal), staff-live-other, all; `end` removes them.
 */
const MINUTE = 60_000;

type QueueSample = Pick<
  QueueLiveProps,
  "phase" | "position" | "etaMinutes" | "startPosition" | "calledAt"
>;

function queue(sample: QueueSample): DesiredActivity {
  const called = sample.phase !== "waiting";
  return {
    kind: "queue",
    subject: QUEUE_LIVE_ACTIVITY_SUBJECT,
    props: {
      v: 1,
      kind: "queue",
      entryId: 1,
      challengeTitle: "Best use of open data",
      roomName: called ? "Room B" : null,
      roomLocation: called ? "Floor 1, east wing" : null,
      otherQueues: 2,
      url: "hackos://queue",
      labels: queueLiveLabels("en", 2),
      updatedAt: new Date().toISOString(),
      ...sample,
    },
  };
}

type StaffSample = { phase: ActivityLiveProps["phase"]; meal: boolean };

function staff({ phase, meal }: StaffSample): DesiredActivity {
  const now = Date.now();
  const startsAt = phase === "upcoming" ? now + 18 * MINUTE : now - 25 * MINUTE;
  const live = phase === "live";
  const id = meal ? 7 : 8;
  return {
    kind: "activity",
    subject: activityLiveActivitySubject(id),
    props: {
      v: 1,
      kind: "activity",
      phase,
      activityId: id,
      name: meal ? "Lunch" : "Opening ceremony",
      category: meal ? "meal" : "ceremony",
      location: meal ? "Cafeteria" : "Main hall",
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 90 * MINUTE).toISOString(),
      scanned: live ? 142 : 0,
      inside: live && meal ? 310 : null,
      remaining: live && meal ? 168 : null,
      scanUrl: `hackos://scan?activity=${id}`,
      url: `hackos://scan?activity=${id}`,
      labels: activityLiveLabels("en"),
      updatedAt: new Date(now).toISOString(),
    },
  };
}

const waiting: QueueSample = {
  phase: "waiting",
  position: 4,
  etaMinutes: 12,
  startPosition: 9,
  calledAt: null,
};

const SAMPLES: Record<string, () => DesiredActivity[]> = {
  "queue-waiting": () => [queue(waiting)],
  "queue-estimating": () => [queue({ ...waiting, etaMinutes: null })],
  "queue-called": () => [
    queue({
      phase: "called",
      position: null,
      etaMinutes: null,
      startPosition: null,
      calledAt: new Date(Date.now() - 2 * MINUTE).toISOString(),
    }),
  ],
  "queue-in-room": () => [
    queue({
      phase: "in_room",
      position: null,
      etaMinutes: null,
      startPosition: null,
      calledAt: new Date(Date.now() - 6 * MINUTE).toISOString(),
    }),
  ],
  "staff-upcoming": () => [staff({ phase: "upcoming", meal: true })],
  "staff-live": () => [staff({ phase: "live", meal: true })],
  "staff-live-other": () => [staff({ phase: "live", meal: false })],
  all: () => [queue(waiting), staff({ phase: "live", meal: true })],
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
