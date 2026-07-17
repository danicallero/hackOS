import { describe, expect, it } from "vitest";
import {
  calledTooLongThresholdMinutes,
  canTransition,
  collaborationState,
  LEGAL_ACTIONS,
  workspaceAccess,
} from "./judging-workspace";

describe("judging workspace H29-H40", () => {
  it("H29-H34 exposes every legal queue transition without combining physical steps", () => {
    for (const [status, actions] of Object.entries(LEGAL_ACTIONS)) {
      for (const action of actions) expect(canTransition(status, action)).toBe(true);
    }
    expect(canTransition("called", "start")).toBe(false);
    expect(canTransition("called", "bring-in")).toBe(true);
    expect(canTransition("in_room", "start")).toBe(true);
  });

  it("H30 keeps cross-room skipping separate from position-changing skip", () => {
    expect(canTransition("waiting", "skip")).toBe(true);
    expect(canTransition("presenting", "skip")).toBe(false);
  });

  it("H33-H35 supports send-back, requeue, recovery, no-show, and disqualification", () => {
    expect(canTransition("in_room", "send-back")).toBe(true);
    expect(canTransition("called", "requeue")).toBe(true);
    expect(canTransition("completed", "re-enter")).toBe(true);
    expect(canTransition("called", "no-show")).toBe(true);
    expect(canTransition("presenting", "disqualify")).toBe(true);
  });

  it("H34 warns using the approved temporary called-too-long rule", () => {
    expect(calledTooLongThresholdMinutes(null)).toBe(10);
    expect(calledTooLongThresholdMinutes(4)).toBe(10);
    expect(calledTooLongThresholdMinutes(8)).toBe(16);
  });

  it("H36 distinguishes acknowledged save, offline work, and conflicts", () => {
    expect(collaborationState({ online: true, saving: true, conflict: false, dirty: true })).toBe(
      "saving",
    );
    expect(collaborationState({ online: true, saving: false, conflict: false, dirty: false })).toBe(
      "saved",
    );
    expect(collaborationState({ online: false, saving: false, conflict: false, dirty: true })).toBe(
      "offline",
    );
    expect(collaborationState({ online: true, saving: false, conflict: true, dirty: true })).toBe(
      "conflict",
    );
  });

  it("H29-H40 scopes actions additively for multi-capability accounts", () => {
    expect(
      workspaceAccess({ operate: true, judge: false, admin: false, exportData: false }),
    ).toEqual({
      canUse: true,
      canOperate: true,
      canJudge: false,
      canAdmin: false,
      canExport: false,
    });
    expect(workspaceAccess({ operate: true, judge: true, admin: true, exportData: true })).toEqual({
      canUse: true,
      canOperate: true,
      canJudge: true,
      canAdmin: true,
      canExport: true,
    });
  });

  it("H40 grants judge access to an association-only room judge with zero capabilities", () => {
    expect(
      workspaceAccess({
        operate: false,
        judge: false,
        admin: false,
        exportData: false,
        isRoomJudge: true,
      }),
    ).toEqual({
      canUse: true,
      canOperate: false,
      canJudge: true,
      canAdmin: false,
      canExport: false,
    });
    expect(
      workspaceAccess({ operate: false, judge: false, admin: false, exportData: false }),
    ).toEqual({
      canUse: false,
      canOperate: false,
      canJudge: false,
      canAdmin: false,
      canExport: false,
    });
  });
});
