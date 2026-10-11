import {
  type ActivityLiveProps,
  activityLiveLabels,
  type MyLiveActivities,
  type QueueLiveProps,
  queueLiveLabels,
} from "@hackos/shared/live-activities";
import {
  androidLiveUpdateId,
  type DesiredActivity,
  desiredActivities,
  LIVE_ACCENT_HEX,
  LIVE_CALLED_HEX,
  LIVE_NEUTRAL_HEX,
  liveActivityRedirectPath,
  nextPhaseBoundary,
  parseAndroidLiveUpdateId,
  parseAndroidLiveUpdateMessage,
  planReconcile,
  propsSignature,
  pruneDismissed,
  queueWaitingFraction,
  toLiveUpdateSpec,
  withScannedIncrement,
} from "./model";

function queueProps(overrides: Partial<QueueLiveProps> = {}): QueueLiveProps {
  return {
    v: 1,
    kind: "queue",
    phase: "waiting",
    entryId: 3,
    challengeTitle: "Open data",
    position: 4,
    etaMinutes: 12,
    roomName: null,
    roomLocation: null,
    otherQueues: 0,
    url: "hackos://queue",
    labels: queueLiveLabels("en", 0),
    updatedAt: "2026-02-20T10:00:00.000Z",
    ...overrides,
  };
}

function activityProps(overrides: Partial<ActivityLiveProps> = {}): ActivityLiveProps {
  return {
    v: 1,
    kind: "activity",
    phase: "upcoming",
    activityId: 12,
    name: "Lunch",
    category: "meal",
    location: "Cafeteria",
    startsAt: "2026-02-20T12:00:00.000Z",
    endsAt: "2026-02-20T13:30:00.000Z",
    scanned: 0,
    scanUrl: "hackos://scan?activity=12",
    url: "hackos://scan?activity=12",
    labels: activityLiveLabels("en"),
    updatedAt: "2026-02-20T11:40:00.000Z",
    ...overrides,
  };
}

const queueItem = (props = queueProps()): DesiredActivity => ({
  kind: "queue",
  subject: "judging",
  props,
});
const activityItem = (props = activityProps()): DesiredActivity => ({
  kind: "activity",
  subject: `activity:${props.activityId}`,
  props,
});

const emptyMemory = {
  signatures: new Map<string, string>(),
  dismissed: new Map<string, string>(),
  previouslyRunning: new Set<string>(),
};

describe("desiredActivities (H38, H25/H26)", () => {
  it("never wants the queue activity outside the judging window", () => {
    const response: MyLiveActivities = {
      judgingWindowOpen: false,
      queue: queueProps(),
      activities: [activityProps()],
    };
    expect(desiredActivities(response).map((item) => item.kind)).toEqual(["activity"]);
  });

  it("keys the queue by the judging subject and activities by id", () => {
    const desired = desiredActivities({
      judgingWindowOpen: true,
      queue: queueProps(),
      activities: [activityProps({ activityId: 7 })],
    });
    expect(desired.map((item) => item.subject)).toEqual(["judging", "activity:7"]);
  });

  it("skips props from an unknown contract version", () => {
    const desired = desiredActivities({
      judgingWindowOpen: true,
      queue: { ...queueProps(), v: 2 } as unknown as QueueLiveProps,
      activities: [],
    });
    expect(desired).toEqual([]);
  });
});

describe("planReconcile", () => {
  it("starts what is missing", () => {
    const plan = planReconcile([queueItem()], [], emptyMemory);
    expect(plan.start).toHaveLength(1);
    expect(plan.update).toEqual([]);
    expect(plan.end).toEqual([]);
  });

  it("updates only when the content changed, ignoring the computation time", () => {
    const props = queueProps();
    const running = [{ id: "a", kind: "queue" as const, subject: null }];
    const signatures = new Map([["queue:judging", propsSignature(props)]]);
    const same = planReconcile(
      [queueItem({ ...props, updatedAt: "2026-02-20T10:05:00.000Z" })],
      running,
      { ...emptyMemory, signatures },
    );
    expect(same.update).toEqual([]);
    const changed = planReconcile([queueItem({ ...props, position: 3 })], running, {
      ...emptyMemory,
      signatures,
    });
    expect(changed.update.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("ends duplicates and surfaces the server no longer lists", () => {
    const plan = planReconcile(
      [queueItem()],
      [
        { id: "a", kind: "queue", subject: null },
        { id: "b", kind: "queue", subject: null },
        { id: "c", kind: "activity", subject: "activity:9" },
      ],
      emptyMemory,
    );
    expect(plan.end.map((surface) => surface.id).sort()).toEqual(["b", "c"]);
  });

  it("adopts a push-started staff activity whose subject is unknown", () => {
    const plan = planReconcile(
      [activityItem()],
      [{ id: "remote", kind: "activity", subject: null }],
      emptyMemory,
    );
    expect(plan.adopt).toEqual([{ id: "remote", subject: "activity:12" }]);
    expect(plan.update.map((entry) => entry.id)).toEqual(["remote"]);
    expect(plan.start).toEqual([]);
  });

  it("ends unknown surfaces nothing can adopt", () => {
    const plan = planReconcile([], [{ id: "x", kind: "activity", subject: null }], emptyMemory);
    expect(plan.end.map((surface) => surface.id)).toEqual(["x"]);
  });

  it("treats a vanished surface the server still lists as dismissed, not as missing", () => {
    const plan = planReconcile([queueItem()], [], {
      ...emptyMemory,
      previouslyRunning: new Set(["queue:judging"]),
    });
    expect(plan.start).toEqual([]);
    expect(plan.dismissed).toEqual([{ key: "queue:judging", phase: "waiting" }]);
  });

  it("keeps a dismissal until the phase changes", () => {
    const dismissed = new Map([["queue:judging", "waiting"]]);
    expect(planReconcile([queueItem()], [], { ...emptyMemory, dismissed }).start).toEqual([]);
    const called = queueItem(
      queueProps({ phase: "called", position: null, etaMinutes: null, roomName: "Room B" }),
    );
    expect(planReconcile([called], [], { ...emptyMemory, dismissed }).start).toHaveLength(1);
  });
});

describe("pruneDismissed", () => {
  it("forgets dismissals whose subject left the list or changed phase", () => {
    const pruned = pruneDismissed(
      { "queue:judging": "waiting", "activity:12": "upcoming", "activity:9": "live" },
      [queueItem(), activityItem(activityProps({ phase: "live" }))],
    );
    expect(pruned).toEqual({ "queue:judging": "waiting" });
  });
});

describe("staff counter and boundaries", () => {
  it("increments the scanned count locally", () => {
    expect(withScannedIncrement(activityProps({ scanned: 4 })).scanned).toBe(5);
  });

  it("returns the next future start or end", () => {
    const now = Date.parse("2026-02-20T11:50:00.000Z");
    expect(nextPhaseBoundary([queueItem(), activityItem()], now)).toBe(
      Date.parse("2026-02-20T12:00:00.000Z"),
    );
    expect(nextPhaseBoundary([queueItem()], now)).toBeNull();
  });
});

describe("toLiveUpdateSpec (Android, #966)", () => {
  const waiting = () => queueProps({ position: 4, startPosition: 9, etaMinutes: 12 });

  it("leads a waiting entry with the ETA and puts position and ETA in the chip", () => {
    const spec = toLiveUpdateSpec(waiting(), null);
    expect(spec).toMatchObject({
      id: "queue:judging",
      title: "~12 min · #4",
      text: "Open data",
      shortCriticalText: "#4·12m",
      icon: "queue",
      phase: "waiting",
      alert: false,
    });
    expect(spec.countdownTo ?? null).toBeNull();
    expect(spec.countUpFrom ?? null).toBeNull();
  });

  it("shows the estimating placeholder, never an empty ETA, and keeps #N in the chip", () => {
    const spec = toLiveUpdateSpec(queueProps({ etaMinutes: null }), null);
    expect(spec.title).toBe("Estimating… · #4");
    expect(spec.shortCriticalText).toBe("#4");
  });

  it("omits a missing label instead of falling back to English (older server)", () => {
    const { estimating: _estimating, ...labels } = queueLiveLabels("en", 0);
    const spec = toLiveUpdateSpec(queueProps({ etaMinutes: null, labels }), null);
    expect(spec.title).toBe("#4");
  });

  it("falls back to the position when position and ETA overflow the 7-character chip", () => {
    const spec = toLiveUpdateSpec(queueProps({ position: 123, etaMinutes: 150 }), null);
    expect(spec.shortCriticalText).toBe("#123");
  });

  it("weights the queue track 2:1 and places the tracker by stage and waiting fraction", () => {
    const track = toLiveUpdateSpec(waiting(), null).progress!;
    expect(track.segments.map((segment) => segment.length)).toEqual([200, 100]);
    expect(track.points).toEqual([{ position: 200, color: LIVE_CALLED_HEX }]);
    // (9 - 4) / 9 of the line behind the team.
    expect(track.value).toBe(Math.round((5 / 9) * 200));
    expect(track.tracker).toBe("tracker-waiting");
    // First sighting: nothing behind yet; unknown start: no fake progress.
    expect(toLiveUpdateSpec(queueProps({ startPosition: 4 }), null).progress!.value).toBe(0);
    expect(toLiveUpdateSpec(queueProps({ startPosition: null }), null).progress!.value).toBe(0);
  });

  it("computes the waiting fraction from the high-water mark", () => {
    expect(queueWaitingFraction(queueProps({ position: 1, startPosition: 4 }))).toBe(0.75);
    expect(queueWaitingFraction(queueProps({ position: 6, startPosition: 4 }))).toBe(0);
  });

  it("shows the room as hero and chip once called, counting up from the call", () => {
    const calledAt = "2026-02-20T10:02:00.000Z";
    const called = queueProps({
      phase: "called",
      position: null,
      etaMinutes: null,
      roomName: "Room B",
      roomLocation: "Floor 1",
      calledAt,
    });
    const spec = toLiveUpdateSpec(called, "waiting");
    expect(spec).toMatchObject({
      title: "Go to Room B",
      text: "Floor 1 · Open data",
      subText: "Called",
      shortCriticalText: "Room B",
      countUpFrom: Date.parse(calledAt),
      accentColor: LIVE_CALLED_HEX,
      alert: true,
    });
    expect(spec.countdownTo ?? null).toBeNull();
    expect(spec.progress).toMatchObject({ value: 200, tracker: "tracker-called" });
    expect(toLiveUpdateSpec(called, "called").alert).toBe(false);
  });

  it("truncates a long room to the chip and moves the tracker to the end in the room", () => {
    const inRoom = queueProps({
      phase: "in_room",
      position: null,
      etaMinutes: null,
      roomName: "Auditorium",
    });
    const spec = toLiveUpdateSpec(inRoom, "called");
    expect(spec).toMatchObject({
      title: "In room · Auditorium",
      shortCriticalText: "Audito…",
      accentColor: LIVE_NEUTRAL_HEX,
      alert: false,
    });
    expect(spec.progress).toMatchObject({ value: 300, tracker: "tracker-in-room" });
  });

  it("never posts an empty chip or a dangling 'Go to' when the room is unknown", () => {
    const called = queueProps({
      phase: "called",
      position: null,
      etaMinutes: null,
      roomName: null,
      roomLocation: "Floor 1",
    });
    expect(toLiveUpdateSpec(called, "waiting")).toMatchObject({
      title: "Floor 1",
      shortCriticalText: null,
      countUpFrom: null,
    });
    const inRoom = queueProps({
      phase: "in_room",
      position: null,
      etaMinutes: null,
      roomName: null,
    });
    expect(toLiveUpdateSpec(inRoom, "called")).toMatchObject({
      title: "In room",
      shortCriticalText: null,
    });
  });

  it("counts down to an upcoming activity, with no chip text, track or action", () => {
    const spec = toLiveUpdateSpec(activityProps(), null);
    expect(spec).toMatchObject({
      id: "activity:12",
      title: "Lunch",
      text: expect.stringContaining("Cafeteria"),
      subText: "Starts in",
      countdownTo: Date.parse("2026-02-20T12:00:00.000Z"),
      icon: "meal",
      phase: "upcoming",
    });
    expect(spec.shortCriticalText ?? null).toBeNull();
    expect(spec.progress ?? null).toBeNull();
    expect(spec.action ?? null).toBeNull();
  });

  it("leads a live meal with who still has to eat and fills the served share", () => {
    const meal = activityProps({ phase: "live", scanned: 142, inside: 310, remaining: 168 });
    const spec = toLiveUpdateSpec(meal, "upcoming");
    expect(spec).toMatchObject({
      title: "168 still to eat",
      text: "142 served · 310 inside · Cafeteria",
      shortCriticalText: "168",
      action: { label: "Scan", url: "hackos://scan?activity=12" },
    });
    // No `when` on live staff updates: the chip keeps the count.
    expect(spec.countdownTo ?? null).toBeNull();
    expect(spec.countUpFrom ?? null).toBeNull();
    expect(spec.progress).toEqual({
      value: Math.round(((310 - 168) / 310) * 100),
      segments: [{ length: 100, color: LIVE_ACCENT_HEX }],
    });
  });

  it("localizes the meal counts and skips the bar when nobody is inside", () => {
    const meal = activityProps({
      phase: "live",
      scanned: 0,
      inside: 0,
      remaining: 0,
      labels: activityLiveLabels("es"),
    });
    const spec = toLiveUpdateSpec(meal, null);
    expect(spec.title).toBe("0 por comer");
    expect(spec.progress).toBeNull();
  });

  it("shows the scanned count and elapsed time for a live non-meal activity", () => {
    const talk = activityProps({ phase: "live", category: "talk", scanned: 37, inside: null });
    // 45 of 90 minutes elapsed.
    const spec = toLiveUpdateSpec(talk, null, Date.parse("2026-02-20T12:45:00.000Z"));
    expect(spec).toMatchObject({
      title: "37 scanned",
      text: "Lunch · Cafeteria",
      shortCriticalText: "37",
      icon: "activity",
      progress: { value: 50 },
    });
  });

  it("round-trips notification ids", () => {
    expect(parseAndroidLiveUpdateId(androidLiveUpdateId("queue", "judging"))).toEqual({
      kind: "queue",
      subject: "judging",
    });
    expect(parseAndroidLiveUpdateId(androidLiveUpdateId("activity", "activity:12"))).toEqual({
      kind: "activity",
      subject: "activity:12",
    });
    expect(parseAndroidLiveUpdateId("default")).toBeNull();
  });
});

describe("parseAndroidLiveUpdateMessage", () => {
  const message = {
    hackosLiveUpdate: { event: "update", kind: "queue", subject: "judging", props: queueProps() },
  };

  it("reads the data object, a nested body and the background dataString", () => {
    expect(parseAndroidLiveUpdateMessage(message)?.event).toBe("update");
    expect(parseAndroidLiveUpdateMessage({ body: JSON.stringify(message) })?.kind).toBe("queue");
    expect(parseAndroidLiveUpdateMessage({ dataString: JSON.stringify(message) })?.subject).toBe(
      "judging",
    );
  });

  it("accepts an end without props and rejects anything else", () => {
    expect(
      parseAndroidLiveUpdateMessage({
        hackosLiveUpdate: { event: "end", kind: "activity", subject: "activity:3" },
      })?.event,
    ).toBe("end");
    expect(parseAndroidLiveUpdateMessage({ category: "queue" })).toBeNull();
    expect(parseAndroidLiveUpdateMessage({ dataString: "{not json" })).toBeNull();
    expect(
      parseAndroidLiveUpdateMessage({
        hackosLiveUpdate: { event: "update", kind: "queue", subject: "judging" },
      }),
    ).toBeNull();
  });
});

describe("liveActivityRedirectPath (deep links)", () => {
  it("opens the scanner bound to the activity", () => {
    expect(liveActivityRedirectPath("hackos://scan?activity=12")).toBe("/activities/12");
    expect(liveActivityRedirectPath("/scan?activity=7")).toBe("/activities/7");
    expect(liveActivityRedirectPath("hackos:///scan?x=1&activity=3")).toBe("/activities/3");
  });

  it("leaves other links to Expo Router", () => {
    expect(liveActivityRedirectPath("hackos://queue")).toBeNull();
    expect(liveActivityRedirectPath("hackos://scan")).toBeNull();
    expect(liveActivityRedirectPath("hackos://scan?activity=abc")).toBeNull();
    expect(liveActivityRedirectPath("hackos://scan?activity=0")).toBeNull();
    expect(liveActivityRedirectPath("https://os.hackudc.com/s/abc")).toBeNull();
  });
});
