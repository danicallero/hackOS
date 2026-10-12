/**
 * #966 (H38, H25/H26): the iOS ActivityKit host. An activity ended as
 * `finished` keeps its final state on the Lock Screen but disappears from
 * `getInstances()`; sign-out and opt-out must still be able to remove it.
 * Every local start and update carries the rank's relevance score.
 */

type FakeInstance = {
  id: string;
  getId: () => string;
  end: jest.Mock;
  update: jest.Mock;
  getPushToken: () => Promise<null>;
  addPushTokenListener: () => { remove(): void };
};

const mockActive: FakeInstance[] = [];
const mockCreated = new Map<string, FakeInstance>();
const mockStart = jest.fn();
const mockAttendeeStart = jest.fn();

function mockInstance(id: string): FakeInstance {
  const instance: FakeInstance = {
    id,
    getId: () => id,
    end: jest.fn(async () => {
      // Ended activities leave `getInstances()` at once, as on a device.
      const index = mockActive.indexOf(instance);
      if (index >= 0) mockActive.splice(index, 1);
    }),
    update: jest.fn(async () => undefined),
    getPushToken: async () => null,
    addPushTokenListener: () => ({ remove() {} }),
  };
  return instance;
}

jest.mock("@/widgets/queue-activity", () => ({
  QueueActivity: {
    start: (...args: unknown[]) => {
      mockStart(...args);
      const instance = mockInstance(`q${mockCreated.size + 1}`);
      mockActive.push(instance);
      mockCreated.set(instance.id, instance);
      return instance;
    },
    getInstances: () => [...mockActive],
  },
}));
jest.mock("@/widgets/staff-activity", () => ({
  StaffActivity: { start: jest.fn(), getInstances: () => [] },
}));
jest.mock("@/widgets/attendee-activity", () => ({
  AttendeeActivity: {
    start: (...args: unknown[]) => {
      mockAttendeeStart(...args);
      return mockInstance(`a${mockAttendeeStart.mock.calls.length}`);
    },
    getInstances: () => [],
  },
}));
jest.mock("@/widgets/deadline-activity", () => ({
  DeadlineActivity: { start: jest.fn(), getInstances: () => [] },
}));
jest.mock("@/widgets/accreditation-activity", () => ({
  AccreditationActivity: { start: jest.fn(), getInstances: () => [] },
}));
jest.mock("./store", () => ({
  readLiveActivityState: async () => ({ iosStaffSubjects: {} }),
  updateLiveActivityState: async () => undefined,
}));

import { attendeeActivityLiveLabels, queueLiveLabels } from "@hackos/shared/live-activities";
import { liveActivityHost } from "./host.ios";

const props = {
  v: 1 as const,
  kind: "queue" as const,
  phase: "called" as const,
  entryId: 3,
  challengeTitle: "Robotics",
  position: null,
  etaMinutes: null,
  roomName: "Room B",
  roomLocation: "Floor 2",
  otherQueues: 0,
  url: "hackos://queue",
  labels: queueLiveLabels("en", 0),
  updatedAt: "2026-10-11T10:00:00.000Z",
};

describe("iOS Live Activity host (#966)", () => {
  it("dismisses a finished activity still on the Lock Screen", async () => {
    const id = await liveActivityHost.start({ kind: "queue", subject: "judging", props }, null);
    const [surface] = liveActivityHost.running();
    expect(surface?.id).toBe(id);

    await liveActivityHost.end(surface!, "finished");
    expect(liveActivityHost.running()).toEqual([]);

    const ended = mockCreated.get(id!);
    expect(ended?.end).toHaveBeenCalledTimes(1);
    // The final state leaves the Lock Screen within a minute, not 15 (#966).
    const policy = ended?.end.mock.calls[0]?.[0] as { after: Date };
    expect(policy.after.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    await liveActivityHost.dismissEnded();
    expect(ended?.end).toHaveBeenLastCalledWith("immediate");

    // Only once: a second sign-out has nothing left to remove.
    ended?.end.mockClear();
    await liveActivityHost.dismissEnded();
    expect(ended?.end).not.toHaveBeenCalled();
  });

  it("starts and updates with the relevance of the device rank", async () => {
    mockStart.mockClear();
    const id = await liveActivityHost.start(
      { kind: "queue", subject: "judging", props: { ...props, rank: 1 } },
      null,
    );
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({ rank: 1 }),
      "hackos://queue",
      expect.any(Date),
      90,
    );

    // Promoted to the top: the update must raise the score, or ActivityKit
    // resets it to 0 and orders the Dynamic Island by start time.
    await liveActivityHost.update(
      id!,
      { kind: "queue", subject: "judging", props: { ...props, rank: 0 } },
      "called",
    );
    expect(mockCreated.get(id!)?.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ rank: 0 }),
      expect.any(Date),
      100,
    );
    await liveActivityHost.end(liveActivityHost.running()[0]!, "immediate");
  });

  it("does not keep an activity ended immediately", async () => {
    const id = await liveActivityHost.start({ kind: "queue", subject: "judging", props }, null);
    const [surface] = liveActivityHost.running();
    await liveActivityHost.end(surface!, "immediate");
    const ended = mockCreated.get(id!);
    expect(ended?.end).toHaveBeenCalledWith("immediate");

    ended?.end.mockClear();
    await liveActivityHost.dismissEnded();
    expect(ended?.end).not.toHaveBeenCalled();
  });

  it("marks local activities stale like the server does", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-10-11T10:00:00.000Z") });
    try {
      mockStart.mockClear();
      await liveActivityHost.start({ kind: "queue", subject: "judging", props }, null);
      expect((mockStart.mock.calls[0]![2] as Date).toISOString()).toBe("2026-10-11T10:30:00.000Z");

      // H59: an upcoming item goes stale at its start, when the widget turns
      // live on its own; a live one at its end.
      const attendee = {
        v: 1 as const,
        kind: "attendee_activity" as const,
        phase: "upcoming" as const,
        scheduleId: 21,
        name: "Keynote",
        category: "talk",
        location: null,
        startsAt: "2026-10-11T10:01:00.000Z",
        endsAt: "2026-10-11T11:00:00.000Z",
        url: "hackos://schedule/21",
        labels: attendeeActivityLiveLabels("en"),
        updatedAt: "2026-10-11T10:00:00.000Z",
      };
      const item = { kind: "attendee_activity" as const, subject: "schedule:21" };
      const id = await liveActivityHost.start({ ...item, props: attendee }, null);
      // The start minus the leeway iOS adds before marking it stale.
      expect((mockAttendeeStart.mock.calls[0]![2] as Date).toISOString()).toBe(
        "2026-10-11T10:00:00.000Z",
      );
      expect(id).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
