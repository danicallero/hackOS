import { describe, expect, it } from "vitest";
import { queueOperationsAccess } from "./queue-access";

const none = {
  canOperate: false,
  canAdmin: false,
  canJudge: false,
  canManageSponsors: false,
  isSponsorRep: false,
};

describe("queue operations access (H46/H55)", () => {
  it("opens queue management for a sponsor representative without exposing room operations", () => {
    expect(queueOperationsAccess({ ...none, isSponsorRep: true })).toEqual({
      canViewRooms: false,
      canManageQueues: true,
      canUse: true,
      defaultTab: "queues",
    });
  });

  it("opens every enterprise's queue management for sponsors:manage", () => {
    expect(queueOperationsAccess({ ...none, canManageSponsors: true })).toMatchObject({
      canViewRooms: false,
      canManageQueues: true,
      canUse: true,
      defaultTab: "queues",
    });
  });

  it("keeps room operations as the default for queue staff and judges", () => {
    for (const grant of ["canOperate", "canAdmin", "canJudge"] as const) {
      expect(queueOperationsAccess({ ...none, [grant]: true })).toMatchObject({
        canViewRooms: true,
        canUse: true,
        defaultTab: "rooms",
      });
    }
  });

  it("denies an account with neither a queue grant nor a sponsor association", () => {
    expect(queueOperationsAccess(none).canUse).toBe(false);
  });
});
