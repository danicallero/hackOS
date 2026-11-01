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
 * staff-upcoming, staff-live (a meal), staff-live-other, staff-starting,
 * all, plus the attendee, deadline and accreditation ones in `KIND_SAMPLES`;
 * `end` removes them. The `-starting` samples start a minute later and turn
 * live then on their own (H25, H59: stale at the start). The `-long` ones are
 * the layout worst cases: long names and places, two-digit hours, four-digit
 * counts.
 */
const MINUTE = 60_000;

type QueueSample = Pick<
  QueueLiveProps,
  "phase" | "position" | "etaMinutes" | "queueTotal" | "calledAhead" | "calledAt"
>;

function queue(sample: QueueSample, long = false): DesiredActivity {
  const called = sample.phase !== "waiting";
  return {
    kind: "queue",
    subject: QUEUE_LIVE_ACTIVITY_SUBJECT,
    props: {
      v: 1,
      kind: "queue",
      entryId: 1,
      challengeTitle: long
        ? "Best use of open government data for civic engagement"
        : "Best use of open data",
      roomName: called ? (long ? "Auditorium Ramón Piñeiro" : "Room B") : null,
      roomLocation: called
        ? long
          ? "Faculty of Computer Science, floor 2, east wing"
          : "Floor 1, east wing"
        : null,
      otherQueues: 2,
      url: "hackos://queue",
      labels: queueLiveLabels("en", 2),
      updatedAt: new Date().toISOString(),
      ...sample,
    },
  };
}

type StaffSample = {
  phase: ActivityLiveProps["phase"];
  meal: boolean;
  startsIn?: number;
  endsIn?: number;
  long?: boolean;
};

function staff({
  phase,
  meal,
  startsIn = 18 * MINUTE,
  endsIn,
  long = false,
}: StaffSample): DesiredActivity {
  const now = Date.now();
  const startsAt = phase === "upcoming" ? now + startsIn : now - 25 * MINUTE;
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
      name: long
        ? "Opening ceremony and sponsor presentations"
        : meal
          ? "Lunch"
          : "Opening ceremony",
      category: meal ? "meal" : "ceremony",
      location: long ? "Faculty of Computer Science main hall" : meal ? "Cafeteria" : "Main hall",
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(
        endsIn === undefined ? startsAt + (startsIn < MINUTE * 2 ? 65 : 90) * MINUTE : now + endsIn,
      ).toISOString(),
      scanned: live ? (long ? 1142 : 142) : 0,
      accredited: live ? (long ? 1380 : 180) : null,
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
  queueTotal: 9,
  calledAhead: null,
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
      queueTotal: null,
      calledAhead: 1,
      calledAt: new Date(Date.now() - 2 * MINUTE).toISOString(),
    }),
  ],
  "queue-in-room": () => [
    queue({
      phase: "in_room",
      position: null,
      etaMinutes: null,
      queueTotal: null,
      calledAhead: null,
      calledAt: new Date(Date.now() - 6 * MINUTE).toISOString(),
    }),
  ],
  "staff-upcoming": () => [staff({ phase: "upcoming", meal: true })],
  "staff-live": () => [staff({ phase: "live", meal: true })],
  "staff-live-other": () => [staff({ phase: "live", meal: false })],
  "staff-starting": () => [staff({ phase: "upcoming", meal: true, startsIn: MINUTE })],
  "staff-upcoming-long": () => [
    staff({
      phase: "upcoming",
      meal: false,
      startsIn: 11 * 60 * MINUTE + 47 * MINUTE,
      long: true,
    }),
  ],
  "staff-upcoming-soon": () => [staff({ phase: "upcoming", meal: false, startsIn: 4 * MINUTE })],
  "staff-live-ending": () => [staff({ phase: "live", meal: true, endsIn: 4 * MINUTE })],
  "staff-live-long": () => [staff({ phase: "live", meal: true, long: true })],
  "queue-waiting-long": () => [
    queue({ ...waiting, position: 128, etaMinutes: 184, queueTotal: 140 }, true),
  ],
  "queue-called-long": () => [
    queue(
      {
        phase: "called",
        position: null,
        etaMinutes: null,
        queueTotal: null,
        calledAhead: 1,
        calledAt: new Date(Date.now() - 2 * MINUTE).toISOString(),
      },
      true,
    ),
  ],
  all: () => [queue(waiting), staff({ phase: "live", meal: true })],
};

/**
 * Returns the route to land on when `path` was a sample link, else null. Any
 * scheme: `hackos://` also opens another installed hackOS build, which then
 * overwrites the shared App Group's layouts; `com.hackudc.os.debug://` only
 * reaches the debug build.
 */
export function handleDevLiveActivityLink(path: string): string | null {
  const match = /^(?:[a-z][a-z0-9+.-]*:)?\/*dev\/live-activity\?sample=([a-z-]+)/i.exec(
    path.trim(),
  );
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  if (name === "end") {
    void endAllActivities();
    return "/";
  }
  const sample = SAMPLES[name] ?? KIND_SAMPLES[name];
  if (sample) void applyDesiredActivities(sample(), { reopen: true }).catch(() => undefined);
  return "/";
}

// ── Attendee, deadline and accreditation kinds (H59, H19, H22) ──

function attendee(
  phase: "upcoming" | "live",
  startsIn = 12 * MINUTE,
  long = false,
): DesiredActivity {
  const now = Date.now();
  const startsAt = phase === "upcoming" ? now + startsIn : now - 20 * MINUTE;
  return {
    kind: "attendee_activity",
    subject: attendeeActivityLiveActivitySubject(21),
    props: {
      v: 1,
      kind: "attendee_activity",
      phase,
      scheduleId: 21,
      name: long
        ? "Intro to Rust for embedded systems and microcontrollers"
        : "Intro to Rust workshop",
      category: "workshop",
      location: long ? "Faculty of Computer Science, lab 0.2" : "Room A2",
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + (startsIn < MINUTE * 2 ? 35 : 60) * MINUTE).toISOString(),
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
  long = false,
  endsIn?: number,
): DesiredActivity {
  const now = Date.now();
  const endsAt =
    now +
    (endsIn ??
      (phase === "closing"
        ? 19 * MINUTE
        : long
          ? 22 * 60 * MINUTE + 45 * MINUTE
          : 2 * 60 * MINUTE + 41 * MINUTE));
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
      projectName: submission
        ? long
          ? "BlackVault: zero-trust secrets vault"
          : "Tidewatch"
        : null,
      url: "hackos://project",
      labels: deadlineLiveLabels("en"),
      rank: 1,
      updatedAt: new Date(now).toISOString(),
    },
  };
}

function accreditation(long = false): DesiredActivity {
  const now = Date.now();
  return {
    kind: "accreditation",
    subject: ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
    props: {
      v: 1,
      kind: "accreditation",
      phase: "live",
      accredited: long ? 1412 : 412,
      eligible: long ? 1600 : 600,
      inside: long ? 1380 : 380,
      recentArrivals: long ? 123 : 23,
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
  "attendee-upcoming-soon": () => [attendee("upcoming", 4 * MINUTE)],
  "attendee-starting": () => [attendee("upcoming", MINUTE)],
  "attendee-upcoming-long": () => [attendee("upcoming", 14 * 60 * MINUTE + 23 * MINUTE, true)],
  "attendee-live-long": () => [attendee("live", 12 * MINUTE, true)],
  "deadline-open": () => [deadline("open", "draft")],
  "deadline-open-unknown": () => [deadline("open", null)],
  "deadline-last-five": () => [deadline("closing", "draft", false, 5 * MINUTE - 5_000)],
  "deadline-last-minute": () => [deadline("closing", "draft", false, 55_000)],
  "deadline-last-seconds": () => [deadline("closing", "draft", false, 25_000)],
  "deadline-submitted-soon": () => [deadline("submitted", "submitted", false, 4 * MINUTE)],
  "deadline-closing": () => [deadline("closing", "draft")],
  "deadline-submitted": () => [deadline("submitted", "submitted")],
  "deadline-open-long": () => [deadline("open", "draft", true)],
  "deadline-closing-long": () => [deadline("closing", "draft", true)],
  "deadline-submitted-long": () => [deadline("submitted", "submitted", true)],
  accreditation: () => [accreditation()],
  "accreditation-long": () => [accreditation(true)],
};
