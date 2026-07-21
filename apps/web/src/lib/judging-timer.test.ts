import { describe, expect, it } from "vitest";
import {
  freezeTotalMinutes,
  presentationTimerState,
  wrapUpThresholdSeconds,
} from "./judging-timer";

const START = "2026-05-01T10:00:00.000Z";
const startedMs = Date.parse(START);
const at = (elapsedSeconds: number) => startedMs + elapsedSeconds * 1000;

describe("presentation timer H34/H39", () => {
  it("counts up from the start and reports the frozen total", () => {
    const state = presentationTimerState({ startedAt: START, totalMinutes: 10, now: at(90) });
    expect(state.elapsedSeconds).toBe(90);
    expect(state.totalSeconds).toBe(600);
    expect(state.remainingSeconds).toBe(510);
    expect(state.progressValue).toBeCloseTo(15);
    expect(state.tone).toBe("default");
  });

  it("switches to warning exactly at the last tenth of the slot", () => {
    // 20 min slot → wrap-up threshold is 120s remaining.
    expect(wrapUpThresholdSeconds(1200)).toBe(120);
    expect(presentationTimerState({ startedAt: START, totalMinutes: 20, now: at(1079) }).tone).toBe(
      "default",
    );
    expect(presentationTimerState({ startedAt: START, totalMinutes: 20, now: at(1080) }).tone).toBe(
      "warning",
    );
  });

  it("never gives less than a minute of warning on short slots", () => {
    // 5 min slot: 10% would be 30s, so the floor of 60s applies.
    expect(wrapUpThresholdSeconds(300)).toBe(60);
    expect(presentationTimerState({ startedAt: START, totalMinutes: 5, now: at(239) }).tone).toBe(
      "default",
    );
    expect(presentationTimerState({ startedAt: START, totalMinutes: 5, now: at(240) }).tone).toBe(
      "warning",
    );
  });

  it("switches to danger only once the slot is actually exceeded", () => {
    const onTheLine = presentationTimerState({ startedAt: START, totalMinutes: 10, now: at(600) });
    expect(onTheLine.remainingSeconds).toBe(0);
    expect(onTheLine.tone).toBe("warning");
    const over = presentationTimerState({ startedAt: START, totalMinutes: 10, now: at(601) });
    expect(over.remainingSeconds).toBe(-1);
    expect(over.tone).toBe("danger");
    // Over-time is advisory: the stopwatch keeps counting up, progress caps at 100.
    expect(over.elapsedSeconds).toBe(601);
    expect(over.progressValue).toBe(100);
  });

  it("stays neutral with a zero or absent total", () => {
    const absent = presentationTimerState({ startedAt: START, totalMinutes: null, now: at(9999) });
    expect(absent.totalSeconds).toBeNull();
    expect(absent.remainingSeconds).toBeNull();
    expect(absent.progressValue).toBe(0);
    expect(absent.isWrappingUp).toBe(false);
    expect(absent.isOverTime).toBe(false);
    expect(absent.tone).toBe("default");

    const zero = presentationTimerState({ startedAt: START, totalMinutes: 0, now: at(30) });
    expect(zero.totalSeconds).toBe(0);
    expect(zero.progressValue).toBe(0);
    expect(zero.isWrappingUp).toBe(false);
    // Elapsed past a zero-length slot is still over time.
    expect(zero.tone).toBe("danger");
  });

  it("reads zero elapsed with no start, and clamps a start in the future", () => {
    expect(
      presentationTimerState({ startedAt: null, totalMinutes: 10, now: at(60) }).elapsedSeconds,
    ).toBe(0);
    expect(
      presentationTimerState({ startedAt: "nonsense", totalMinutes: 10, now: at(60) })
        .elapsedSeconds,
    ).toBe(0);
    expect(
      presentationTimerState({ startedAt: START, totalMinutes: 10, now: at(-60) }).elapsedSeconds,
    ).toBe(0);
  });
});

describe("frozen presentation total H39", () => {
  it("keeps the total captured at the start of the presentation", () => {
    const first = freezeTotalMinutes({ key: null, minutes: null }, START, 10);
    expect(first).toEqual({ key: START, minutes: 10 });
    // A live pace refetch mid-presentation must not shift the total.
    const refetched = freezeTotalMinutes(first, START, 4);
    expect(refetched.minutes).toBe(10);
    expect(
      presentationTimerState({ startedAt: START, totalMinutes: refetched.minutes, now: at(300) })
        .totalSeconds,
    ).toBe(600);
  });

  it("captures the total once when the pace was not ready at the start", () => {
    const pending = freezeTotalMinutes({ key: null, minutes: null }, START, null);
    expect(pending).toEqual({ key: START, minutes: null });
    const captured = freezeTotalMinutes(pending, START, 7);
    expect(captured).toEqual({ key: START, minutes: 7 });
    expect(freezeTotalMinutes(captured, START, 3).minutes).toBe(7);
  });

  it("re-freezes for the next presentation", () => {
    const held = { key: START, minutes: 10 };
    const next = "2026-05-01T10:30:00.000Z";
    expect(freezeTotalMinutes(held, next, 4)).toEqual({ key: next, minutes: 4 });
    expect(freezeTotalMinutes(held, null, null)).toEqual({ key: null, minutes: null });
  });
});
