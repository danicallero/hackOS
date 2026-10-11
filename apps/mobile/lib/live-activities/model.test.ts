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
  liveActivityRedirectPath,
  nextPhaseBoundary,
  parseAndroidLiveUpdateId,
  parseAndroidLiveUpdateMessage,
  planReconcile,
  propsSignature,
  pruneDismissed,
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

describe("toLiveUpdateSpec (Android)", () => {
  it("maps a waiting queue entry to position and ETA with the ETA chip", () => {
    const spec = toLiveUpdateSpec(queueProps(), null);
    expect(spec).toMatchObject({
      id: "queue:judging",
      title: "Open data",
      text: "Position #4 · Wait ~12 min",
      shortCriticalText: "~12m",
      icon: "queue",
      alert: false,
    });
  });

  it("alerts only on the transition into called", () => {
    const called = queueProps({
      phase: "called",
      position: null,
      etaMinutes: null,
      roomName: "Room B",
      roomLocation: "Floor 1",
    });
    expect(toLiveUpdateSpec(called, "waiting")).toMatchObject({
      text: "Go to Room B · Floor 1",
      shortCriticalText: "Room B",
      alert: true,
    });
    expect(toLiveUpdateSpec(called, "called").alert).toBe(false);
  });

  it("counts down to an upcoming activity without an action", () => {
    const spec = toLiveUpdateSpec(activityProps(), null);
    expect(spec.countdownTo).toBe(Date.parse("2026-02-20T12:00:00.000Z"));
    expect(spec.action).toBeNull();
    expect(spec.icon).toBe("meal");
    expect(spec.id).toBe("activity:12");
  });

  it("shows the live count and the single Scan action", () => {
    const spec = toLiveUpdateSpec(activityProps({ phase: "live", scanned: 37 }), "upcoming");
    expect(spec).toMatchObject({
      shortCriticalText: "37",
      countdownTo: null,
      action: { label: "Scan", url: "hackos://scan?activity=12" },
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
