import { durationMinutes, securedWindowFraction } from "./presence-timeline";

describe("presence timeline helpers", () => {
  test("calculates and clamps the secured part of a certainty window", () => {
    const base = {
      start: "2026-07-15T08:00:00.000Z",
      deadline: "2026-07-15T20:00:00.000Z",
    };

    expect(securedWindowFraction({ ...base, securedUntil: null })).toBe(0);
    expect(securedWindowFraction({ ...base, securedUntil: "2026-07-15T14:00:00.000Z" })).toBe(0.5);
    expect(securedWindowFraction({ ...base, securedUntil: "2026-07-16T08:00:00.000Z" })).toBe(1);
  });

  test("returns a non-negative rounded duration", () => {
    expect(durationMinutes("2026-07-15T08:00:00.000Z", "2026-07-15T09:30:00.000Z")).toBe(90);
    expect(durationMinutes("2026-07-15T10:00:00.000Z", "2026-07-15T09:00:00.000Z")).toBe(0);
  });
});
