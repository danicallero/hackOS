import { describe, expect, it } from "vitest";
import {
  calledEntryAffordances,
  calledTooLongThresholdMinutes,
  canTransition,
  collaborationState,
  hasWaitedTooLong,
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

  it("H34 prefers the operator-configured called-too-long threshold", () => {
    expect(calledTooLongThresholdMinutes(null, 3)).toBe(3);
    expect(calledTooLongThresholdMinutes(8, 25)).toBe(25);
    // Precedence: the configured value wins even when it is *shorter* than the
    // fallback would have been — that is the point of configuring it.
    expect(calledTooLongThresholdMinutes(8, 2)).toBe(2);
  });

  it("H34 falls back to max(10, 2x desired) when the room has no configured threshold", () => {
    expect(calledTooLongThresholdMinutes(null)).toBe(10);
    expect(calledTooLongThresholdMinutes(4)).toBe(10);
    expect(calledTooLongThresholdMinutes(8)).toBe(16);
    expect(calledTooLongThresholdMinutes(8, null)).toBe(16);
    // Non-positive / non-finite settings are ignored rather than trusted.
    expect(calledTooLongThresholdMinutes(8, 0)).toBe(16);
    expect(calledTooLongThresholdMinutes(8, Number.NaN)).toBe(16);
  });

  it("H34 warns only once the effective threshold has elapsed since the call", () => {
    const now = Date.parse("2026-05-01T12:00:00.000Z");
    const calledAt = "2026-05-01T11:55:00.000Z"; // 5 minutes ago
    // Fallback (10 min) has not elapsed yet; a 5-minute configured one has.
    expect(hasWaitedTooLong(calledAt, 4, null, now)).toBe(false);
    expect(hasWaitedTooLong(calledAt, 4, 5, now)).toBe(true);
    // A longer configured threshold suppresses a warning the fallback would show.
    expect(hasWaitedTooLong("2026-05-01T11:45:00.000Z", 4, null, now)).toBe(true);
    expect(hasWaitedTooLong("2026-05-01T11:45:00.000Z", 4, 30, now)).toBe(false);
    expect(hasWaitedTooLong(null, 4, 5, now)).toBe(false);
    expect(hasWaitedTooLong("not-a-date", 4, 5, now)).toBe(false);
  });

  it("H34-H35 gates the no-show ladder by role and in-flight action", () => {
    const judge = { busy: false, canJudge: true, canOperate: false, canAdmin: false };
    expect(calledEntryAffordances(judge)).toEqual({
      canNotifyEnter: true,
      canBringIn: true,
      canOpenMore: true,
      canDisqualify: false,
    });
    // An operator may notify and use the ladder, but not physically bring in.
    expect(
      calledEntryAffordances({ busy: false, canJudge: false, canOperate: true, canAdmin: false }),
    ).toEqual({
      canNotifyEnter: true,
      canBringIn: false,
      canOpenMore: true,
      canDisqualify: false,
    });
    // Neither judge nor operator: read-only at the door.
    expect(
      calledEntryAffordances({ busy: false, canJudge: false, canOperate: false, canAdmin: true }),
    ).toEqual({
      canNotifyEnter: false,
      canBringIn: false,
      canOpenMore: false,
      canDisqualify: true,
    });
    // An in-flight action disables every button but leaves disqualify visible.
    expect(calledEntryAffordances({ ...judge, busy: true, canAdmin: true })).toEqual({
      canNotifyEnter: false,
      canBringIn: false,
      canOpenMore: false,
      canDisqualify: true,
    });
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
