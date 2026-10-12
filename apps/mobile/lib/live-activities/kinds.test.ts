/**
 * #966 (H59 attendee, H19 deadline, H22 accreditation): the newer kinds in
 * the server's list, rank order and the per-device `maxConcurrent` limit.
 */
import {
  type AccreditationLiveProps,
  type ActivityLiveProps,
  type AttendeeActivityLiveProps,
  accreditationLiveLabels,
  activityLiveLabels,
  attendeeActivityLiveLabels,
  countdownFlags,
  countdownLastFiveMinutes,
  countdownLastMinute,
  countdownLastTenSeconds,
  countdownShortMinutes,
  countdownUnderHour,
  countdownUnderTenMinutes,
  type DeadlineLiveProps,
  deadlineLiveLabels,
  type MyLiveActivities,
  nextCountdownBoundary,
} from "@hackos/shared/live-activities";
import { desiredActivities, nextPhaseBoundary } from "./model";

const attendee = (scheduleId: number, rank?: number): AttendeeActivityLiveProps => ({
  v: 1,
  kind: "attendee_activity",
  phase: "upcoming",
  scheduleId,
  name: "Workshop",
  category: "workshop",
  location: null,
  startsAt: "2026-02-20T12:10:00.000Z",
  endsAt: "2026-02-20T13:10:00.000Z",
  url: `hackos://schedule/${scheduleId}`,
  labels: attendeeActivityLiveLabels("en"),
  ...(rank === undefined ? {} : { rank }),
  updatedAt: "2026-02-20T12:00:00.000Z",
});

const deadline = (rank?: number): DeadlineLiveProps => ({
  v: 1,
  kind: "deadline",
  phase: "open",
  startsAt: null,
  endsAt: "2026-02-20T14:00:00.000Z",
  submission: null,
  projectName: null,
  url: "hackos://project",
  labels: deadlineLiveLabels("en"),
  ...(rank === undefined ? {} : { rank }),
  updatedAt: "2026-02-20T12:00:00.000Z",
});

const accreditation = (rank?: number): AccreditationLiveProps => ({
  v: 1,
  kind: "accreditation",
  phase: "live",
  accredited: 1,
  eligible: 2,
  inside: null,
  recentArrivals: 0,
  endsAt: "2026-02-20T13:30:00.000Z",
  scanUrl: "hackos://scan",
  url: "hackos://scan",
  labels: accreditationLiveLabels("en"),
  ...(rank === undefined ? {} : { rank }),
  updatedAt: "2026-02-20T12:00:00.000Z",
});

const staff = (rank?: number): ActivityLiveProps => ({
  v: 1,
  kind: "activity",
  phase: "upcoming",
  activityId: 7,
  name: "Lunch",
  category: "meal",
  location: null,
  startsAt: "2026-02-20T12:30:00.000Z",
  endsAt: "2026-02-20T13:30:00.000Z",
  scanned: 0,
  scanUrl: "hackos://scan?activity=7",
  url: "hackos://scan?activity=7",
  labels: activityLiveLabels("en"),
  ...(rank === undefined ? {} : { rank }),
  updatedAt: "2026-02-20T12:00:00.000Z",
});

function response(overrides: Partial<MyLiveActivities>): MyLiveActivities {
  return { judgingWindowOpen: false, queue: null, activities: [], ...overrides };
}

const keys = (list: ReturnType<typeof desiredActivities>) =>
  list.map((item) => `${item.kind}:${item.subject}`);

describe("desiredActivities: attendee, deadline and accreditation (#966)", () => {
  it("keys each new kind by its subject", () => {
    expect(
      keys(
        desiredActivities(
          response({
            attendeeActivities: [attendee(21)],
            deadline: deadline(),
            accreditation: accreditation(),
          }),
        ),
      ),
    ).toEqual([
      "attendee_activity:schedule:21",
      "deadline:deadline",
      "accreditation:accreditation",
    ]);
  });

  it("reads an older server's response, without the new fields", () => {
    expect(desiredActivities(response({}))).toEqual([]);
  });

  it("skips a new kind from an unknown contract version", () => {
    const future = { ...deadline(), v: 2 } as unknown as DeadlineLiveProps;
    expect(desiredActivities(response({ deadline: future }))).toEqual([]);
  });

  it("orders by rank, the most important first, unranked last", () => {
    const list = desiredActivities(
      response({
        activities: [staff(2)],
        attendeeActivities: [attendee(21), attendee(22, 0)],
        deadline: deadline(1),
      }),
    );
    expect(keys(list)).toEqual([
      "attendee_activity:schedule:22",
      "deadline:deadline",
      "activity:activity:7",
      "attendee_activity:schedule:21",
    ]);
  });

  it("never starts more than maxConcurrent locally, keeping the top ranks", () => {
    const list = desiredActivities(
      response({
        maxConcurrent: 2,
        activities: [staff(0)],
        attendeeActivities: [attendee(21, 1)],
        deadline: deadline(2),
        accreditation: accreditation(3),
      }),
    );
    expect(keys(list)).toEqual(["activity:activity:7", "attendee_activity:schedule:21"]);
  });

  it("ignores an invalid limit", () => {
    const list = desiredActivities(
      response({ maxConcurrent: 0, deadline: deadline(), accreditation: accreditation() }),
    );
    expect(list).toHaveLength(2);
  });
});

describe("nextPhaseBoundary: new kinds", () => {
  it("refreshes at an attendee start, the deadline and the desk's end", () => {
    const now = Date.parse("2026-02-20T12:00:00.000Z");
    const at = (iso: string) => Date.parse(iso);
    const desk = desiredActivities(response({ accreditation: accreditation() }));
    expect(nextPhaseBoundary(desk, now)).toBe(at("2026-02-20T13:30:00.000Z"));
    // #966: the deadline (14:00) is first refreshed when the minutes-of-hour
    // reach 9 (`1h 10m` left), so the widget goes from `1h 12m` to `1h 9m`.
    const desired = desiredActivities(
      response({ deadline: deadline(), accreditation: accreditation() }),
    );
    expect(nextPhaseBoundary(desired, now)).toBe(at("2026-02-20T12:50:00.000Z"));
    // Then the full hour (`1h 0m` to `59m`), before the desk ends at 13:30.
    expect(nextPhaseBoundary(desired, at("2026-02-20T12:50:00.000Z"))).toBe(
      at("2026-02-20T13:00:00.000Z"),
    );
    expect(nextPhaseBoundary(desired, at("2026-02-20T13:00:00.000Z"))).toBe(
      at("2026-02-20T13:30:00.000Z"),
    );
    const withAttendee = desiredActivities(
      response({ attendeeActivities: [attendee(21)], deadline: deadline() }),
    );
    expect(nextPhaseBoundary(withAttendee, now)).toBe(at("2026-02-20T12:05:00.000Z"));
  });
});

describe("countdownUnderHour (#966)", () => {
  it("flips once the time left is under an hour", () => {
    const target = "2026-02-20T14:00:00.000Z";
    expect(countdownUnderHour(target, Date.parse("2026-02-20T13:00:00.000Z"))).toBe(false);
    expect(countdownUnderHour(target, Date.parse("2026-02-20T13:00:00.001Z"))).toBe(true);
    expect(countdownUnderHour(new Date(target), new Date("2026-02-20T13:59:00.000Z"))).toBe(true);
  });
});

describe("countdownLastFiveMinutes (#966)", () => {
  it("switches to colon notation at five minutes, changing state without per-second pushes", () => {
    const target = "2026-02-20T14:00:00.000Z";
    expect(countdownLastFiveMinutes(target, Date.parse("2026-02-20T13:54:59.999Z"))).toBe(false);
    expect(countdownLastFiveMinutes(target, Date.parse("2026-02-20T13:55:00.000Z"))).toBe(true);
    expect(countdownLastFiveMinutes(new Date(target), new Date("2026-02-20T13:59:00.000Z"))).toBe(
      true,
    );
    const desired = desiredActivities(response({ deadline: deadline() }));
    expect(nextPhaseBoundary(desired, Date.parse("2026-02-20T13:50:01.000Z"))).toBe(
      Date.parse("2026-02-20T13:55:00.000Z"),
    );
  });
});

describe("countdownLastMinute (#966)", () => {
  it("switches below a minute and schedules the next foreground re-render", () => {
    const target = "2026-02-20T14:00:00.000Z";
    expect(countdownLastMinute(target, Date.parse("2026-02-20T13:59:00.000Z"))).toBe(false);
    expect(countdownLastMinute(target, Date.parse("2026-02-20T13:59:00.001Z"))).toBe(true);
    const desired = desiredActivities(response({ deadline: deadline() }));
    expect(nextPhaseBoundary(desired, Date.parse("2026-02-20T13:55:01.000Z"))).toBe(
      Date.parse("2026-02-20T13:59:00.000Z"),
    );
  });
});

describe("no leading zero beside a unit (#966)", () => {
  const target = "2026-02-20T14:00:00.000Z";
  const left = (ms: number) => Date.parse(target) - ms;
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  it("countdownUnderTenMinutes: the minutes field drops to one digit (`9m`)", () => {
    expect(countdownUnderTenMinutes(target, left(10 * MIN))).toBe(false);
    expect(countdownUnderTenMinutes(target, left(10 * MIN - 1))).toBe(true);
  });

  it("countdownLastTenSeconds: the seconds field drops to one digit (`9s`)", () => {
    expect(countdownLastTenSeconds(target, left(10_000))).toBe(false);
    expect(countdownLastTenSeconds(target, left(9_999))).toBe(true);
  });

  it("countdownShortMinutes: `1h 5m` while the minutes-of-hour are under ten, never under an hour", () => {
    expect(countdownShortMinutes(target, left(2 * HOUR + 34 * MIN))).toBe(false);
    expect(countdownShortMinutes(target, left(2 * HOUR + 10 * MIN))).toBe(false);
    expect(countdownShortMinutes(target, left(2 * HOUR + 10 * MIN - 1))).toBe(true);
    expect(countdownShortMinutes(target, left(HOUR))).toBe(true);
    expect(countdownShortMinutes(target, left(HOUR - 1))).toBe(false);
    expect(countdownShortMinutes(target, left(5 * MIN))).toBe(false);
    expect(countdownFlags(target, left(HOUR + 5 * MIN))).toEqual({
      countdownUnderHour: false,
      countdownShortMinutes: true,
      countdownUnderTenMinutes: false,
      countdownLastFiveMinutes: false,
      countdownLastMinute: false,
      countdownLastTenSeconds: false,
    });
  });

  it("nextCountdownBoundary walks every width change down to the last ten seconds", () => {
    const walk: string[] = [];
    let now = left(2 * HOUR + 30 * MIN);
    for (let i = 0; i < 9; i += 1) {
      const next = nextCountdownBoundary(target, now);
      if (next === null) break;
      walk.push(new Date(next).toISOString().slice(11, 19));
      now = next;
    }
    expect(walk).toEqual([
      "11:50:00", // 2h 10m left: minutes-of-hour reach 9 (`2h 9m`)
      "12:00:00", // 2h: `1h 59m`
      "12:50:00", // 1h 10m: `1h 9m`
      "13:00:00", // 1h: `59m`
      "13:50:00", // 10m: `9m`
      "13:55:00", // 5m: `4:59`
      "13:59:00", // 1m: `59s`
      "13:59:50", // 10s: `9s`
    ]);
    expect(nextCountdownBoundary(target, left(9_000))).toBeNull();
    expect(nextCountdownBoundary("not a date", 0)).toBeNull();
  });
});
