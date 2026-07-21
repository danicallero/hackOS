import { describe, expect, it } from "vitest";
import {
  calledTooLongThresholdMinutes,
  canTransition,
  collaborationState,
  freezeTotalMinutes,
  hasWaitedTooLong,
  LEGAL_ACTIONS,
  presentationTimerState,
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

  it("H34/H203 prefers the operator-configured called-too-long threshold", () => {
    // Configured value wins over the derived fallback, in both directions.
    expect(calledTooLongThresholdMinutes(8, 5)).toBe(5);
    expect(calledTooLongThresholdMinutes(4, 45)).toBe(45);
    // Absent or nonsensical settings fall back to max(10, 2x desired).
    expect(calledTooLongThresholdMinutes(null)).toBe(10);
    expect(calledTooLongThresholdMinutes(4)).toBe(10);
    expect(calledTooLongThresholdMinutes(8)).toBe(16);
    expect(calledTooLongThresholdMinutes(8, null)).toBe(16);
    expect(calledTooLongThresholdMinutes(8, 0)).toBe(16);
  });

  it("H34 flags a team called longer ago than the effective threshold", () => {
    const now = new Date("2026-07-22T12:00:00Z").getTime();
    const calledAt = new Date("2026-07-22T11:48:00Z").toISOString(); // 12 minutes ago

    // Fallback rule: 10-minute threshold, so 12 minutes is too long.
    expect(hasWaitedTooLong(calledAt, null, null, now)).toBe(true);
    // A configured 20-minute threshold means the same wait is still fine —
    // this is the case that silently did nothing before the setting was wired.
    expect(hasWaitedTooLong(calledAt, null, 20, now)).toBe(false);
    // A configured 5-minute threshold flags a wait the fallback would allow.
    expect(hasWaitedTooLong(calledAt, 30, 5, now)).toBe(true);

    // Never warns without a called_at, or on an unparseable one.
    expect(hasWaitedTooLong(null, null, 1, now)).toBe(false);
    expect(hasWaitedTooLong("not-a-date", null, 1, now)).toBe(false);
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

  it("H39 counts the presentation up and tones it at the wrap-up and over-time marks", () => {
    const startedAt = "2026-07-22T12:00:00Z";
    const at = (seconds: number) => new Date("2026-07-22T12:00:00Z").getTime() + seconds * 1000;

    // 10-minute slot: counts up, on time, progress tracks elapsed.
    const early = presentationTimerState(startedAt, 10, at(120));
    expect(early).toMatchObject({
      elapsedSeconds: 120,
      totalSeconds: 600,
      remainingSeconds: 480,
      tone: "default",
    });
    expect(early.progressValue).toBeCloseTo(20);

    // Wrap-up starts at max(60s, 10% of total) = 60s remaining, inclusive.
    expect(presentationTimerState(startedAt, 10, at(539)).tone).toBe("default");
    expect(presentationTimerState(startedAt, 10, at(540)).tone).toBe("warning");

    // A long slot uses the 10% arm instead of the 60s floor: 30min -> 180s.
    expect(presentationTimerState(startedAt, 30, at(1619)).tone).toBe("default");
    expect(presentationTimerState(startedAt, 30, at(1620)).tone).toBe("warning");

    // Over time is red, keeps counting up, and progress clamps at 100.
    const over = presentationTimerState(startedAt, 10, at(700));
    expect(over).toMatchObject({ elapsedSeconds: 700, remainingSeconds: -100, tone: "danger" });
    expect(over.progressValue).toBe(100);

    // No total to count against: still counts up, never tones, no progress.
    expect(presentationTimerState(startedAt, null, at(90))).toEqual({
      elapsedSeconds: 90,
      totalSeconds: null,
      remainingSeconds: null,
      progressValue: 0,
      tone: "default",
    });

    // Not started, or an unparseable start, reads as zero rather than NaN.
    expect(presentationTimerState(null, 10, at(90)).elapsedSeconds).toBe(0);
    expect(presentationTimerState("not-a-date", 10, at(90)).elapsedSeconds).toBe(0);
    // A clock skewed behind the start never shows negative elapsed.
    expect(presentationTimerState(startedAt, 10, at(-30)).elapsedSeconds).toBe(0);

    // Exactly on the limit is still amber, not red: red means *over*, and a
    // team that lands on the second shouldn't be shown as having run over.
    const onTheLine = presentationTimerState(startedAt, 10, at(600));
    expect(onTheLine).toMatchObject({ remainingSeconds: 0, tone: "warning" });
    expect(presentationTimerState(startedAt, 10, at(601)).tone).toBe("danger");

    // A zero-length slot has no wrap-up window to warn in, so any elapsed time
    // is already over — and progress stays 0 rather than dividing by zero.
    const zero = presentationTimerState(startedAt, 0, at(30));
    expect(zero).toMatchObject({ totalSeconds: 0, progressValue: 0, tone: "danger" });
  });

  it("H39 freezes the presentation total against mid-presentation pace refetches", () => {
    const startedAt = "2026-07-22T12:00:00Z";

    // Captured at the start, then held: the pace recomputing to 4 minutes
    // mid-presentation must not shrink the total being counted against.
    const first = freezeTotalMinutes({ key: null, minutes: null }, startedAt, 10);
    expect(first).toEqual({ key: startedAt, minutes: 10 });
    expect(freezeTotalMinutes(first, startedAt, 4).minutes).toBe(10);

    // The pace often isn't ready when the presentation begins: capture it once,
    // late, then hold that too.
    const pending = freezeTotalMinutes({ key: null, minutes: null }, startedAt, null);
    expect(pending).toEqual({ key: startedAt, minutes: null });
    const captured = freezeTotalMinutes(pending, startedAt, 7);
    expect(captured).toEqual({ key: startedAt, minutes: 7 });
    expect(freezeTotalMinutes(captured, startedAt, 3).minutes).toBe(7);

    // The next presentation re-freezes, and ending one clears the hold.
    const next = "2026-07-22T12:30:00Z";
    expect(freezeTotalMinutes(captured, next, 4)).toEqual({ key: next, minutes: 4 });
    expect(freezeTotalMinutes(captured, null, null)).toEqual({ key: null, minutes: null });
  });
});
