/**
 * #966 (H38, H25/H26): the iOS ActivityKit host. An activity ended as
 * `finished` keeps its final state on the Lock Screen but disappears from
 * `getInstances()`; sign-out and opt-out must still be able to remove it.
 */

type FakeInstance = {
  id: string;
  getId: () => string;
  end: jest.Mock;
  getPushToken: () => Promise<null>;
  addPushTokenListener: () => { remove(): void };
};

const mockActive: FakeInstance[] = [];
const mockCreated = new Map<string, FakeInstance>();

function mockInstance(id: string): FakeInstance {
  const instance: FakeInstance = {
    id,
    getId: () => id,
    end: jest.fn(async () => {
      // Ended activities leave `getInstances()` at once, as on a device.
      const index = mockActive.indexOf(instance);
      if (index >= 0) mockActive.splice(index, 1);
    }),
    getPushToken: async () => null,
    addPushTokenListener: () => ({ remove() {} }),
  };
  return instance;
}

jest.mock("@/widgets/queue-activity", () => ({
  QueueActivity: {
    start: () => {
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
  AttendeeActivity: { start: jest.fn(), getInstances: () => [] },
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

import { queueLiveLabels } from "@hackos/shared/live-activities";
import { liveActivityHost, staleDateFor } from "./host.ios";

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
    await liveActivityHost.dismissEnded();
    expect(ended?.end).toHaveBeenLastCalledWith("immediate");

    // Only once: a second sign-out has nothing left to remove.
    ended?.end.mockClear();
    await liveActivityHost.dismissEnded();
    expect(ended?.end).not.toHaveBeenCalled();
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

  it("marks local activities stale like the server does", () => {
    const now = Date.parse("2026-10-11T10:00:00.000Z");
    expect(staleDateFor(props, now).toISOString()).toBe("2026-10-11T10:30:00.000Z");
    const ending = { ...props, kind: "deadline", endsAt: "2026-10-11T12:00:00.000Z" };
    expect(staleDateFor(ending as never, now).toISOString()).toBe("2026-10-11T12:00:00.000Z");
  });
});
