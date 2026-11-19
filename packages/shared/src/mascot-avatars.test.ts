import { describe, expect, it } from "vitest";
import { MASCOT_AVATARS, MASCOT_BACKGROUNDS, mascotAvatarChoice } from "./mascot-avatars.js";

describe("person mascot assignment (#934, H55)", () => {
  it("uses the same identity across platforms, renames and session changes", () => {
    expect(mascotAvatarChoice(42, "Ana")).toEqual(mascotAvatarChoice("42", "Ana Souto"));
    expect(mascotAvatarChoice(42)).toEqual(mascotAvatarChoice(42));
  });

  it("normalizes the name only when no id is available", () => {
    expect(mascotAvatarChoice(undefined, "  ANA  ")).toEqual(mascotAvatarChoice(null, "ana"));
  });

  it("distributes artwork, colours and their combinations across sequential user ids", () => {
    const drawings = Array(MASCOT_AVATARS.length).fill(0);
    const colors = Array(MASCOT_BACKGROUNDS.length).fill(0);
    const combinations = new Set<string>();
    for (let id = 1; id <= 31000; id += 1) {
      const { index, background } = mascotAvatarChoice(id);
      drawings[index] += 1;
      colors[MASCOT_BACKGROUNDS.indexOf(background)] += 1;
      combinations.add(`${index}:${background}`);
    }
    expect(Math.min(...drawings)).toBeGreaterThan(850);
    expect(Math.max(...drawings)).toBeLessThan(1150);
    expect(Math.min(...colors)).toBeGreaterThan(4700);
    expect(Math.max(...colors)).toBeLessThan(5600);
    expect(combinations.size).toBe(MASCOT_AVATARS.length * MASCOT_BACKGROUNDS.length);
  });
});
