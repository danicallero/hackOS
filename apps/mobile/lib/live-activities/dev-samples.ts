import {
  ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
  type ActivityLiveProps,
  accreditationLiveLabels,
  activityLiveActivitySubject,
  activityLiveLabels,
  attendeeActivityLiveActivitySubject,
  attendeeActivityLiveLabels,
  DEADLINE_LIVE_ACTIVITY_SUBJECT,
  type DeadlineLiveProps,
  deadlineLiveLabels,
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
 * staff-upcoming, staff-live (a meal), staff-live-other, all, plus the
 * attendee, deadline and accreditation ones in `KIND_SAMPLES`;
 * `end` removes them.
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
      accredited: live ? 180 : null,
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
  const sample = SAMPLES[name] ?? KIND_SAMPLES[name];
  if (sample) void applyDesiredActivities(sample()).catch(() => undefined);
  return "/";
}

// ── Attendee, deadline and accreditation kinds (H59, H19, H22) ──

function attendee(phase: "upcoming" | "live"): DesiredActivity {
  const now = Date.now();
  const startsAt = phase === "upcoming" ? now + 12 * MINUTE : now - 20 * MINUTE;
  return {
    kind: "attendee_activity",
    subject: attendeeActivityLiveActivitySubject(21),
    props: {
      v: 1,
      kind: "attendee_activity",
      phase,
      scheduleId: 21,
      name: "Intro to Rust workshop",
      category: "workshop",
      location: "Room A2",
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 60 * MINUTE).toISOString(),
      url: "hackos://schedule/21",
      labels: attendeeActivityLiveLabels("en"),
      rank: 0,
      updatedAt: new Date(now).toISOString(),
    },
  };
}

function deadline(
  phase: DeadlineLiveProps["phase"],
  submission: DeadlineLiveProps["submission"],
): DesiredActivity {
  const now = Date.now();
  const endsAt = now + (phase === "closing" ? 11 * MINUTE : 2 * 60 * MINUTE + 41 * MINUTE);
  return {
    kind: "deadline",
    subject: DEADLINE_LIVE_ACTIVITY_SUBJECT,
    props: {
      v: 1,
      kind: "deadline",
      phase,
      startsAt: new Date(endsAt - 36 * 60 * MINUTE).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      submission,
      projectName: submission ? "Tidewatch" : null,
      url: "hackos://project",
      labels: deadlineLiveLabels("en"),
      rank: 1,
      updatedAt: new Date(now).toISOString(),
    },
  };
}

function accreditation(): DesiredActivity {
  const now = Date.now();
  return {
    kind: "accreditation",
    subject: ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
    props: {
      v: 1,
      kind: "accreditation",
      phase: "live",
      accredited: 412,
      eligible: 600,
      inside: 380,
      recentArrivals: 23,
      endsAt: new Date(now + 47 * MINUTE).toISOString(),
      scanUrl: "hackos://scan",
      url: "hackos://scan",
      labels: accreditationLiveLabels("en"),
      rank: 0,
      updatedAt: new Date(now).toISOString(),
    },
  };
}

const KIND_SAMPLES: Record<string, () => DesiredActivity[]> = {
  "attendee-upcoming": () => [attendee("upcoming")],
  "attendee-live": () => [attendee("live")],
  "deadline-open": () => [deadline("open", "draft")],
  "deadline-open-unknown": () => [deadline("open", null)],
  "deadline-closing": () => [deadline("closing", "draft")],
  "deadline-submitted": () => [deadline("submitted", "submitted")],
  accreditation: () => [accreditation()],
};
