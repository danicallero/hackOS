import { describe, expect, it } from "vitest";
import { rankDestination } from "./command-palette";

describe("rankDestination (#1182)", () => {
  it("ranks a title prefix above keyword-only matches and drops scattered letters", () => {
    const stats = rankDestination("/logistics/stats", "stats", ["Stats", "Logistics"]);
    const profile = rankDestination("/profile", "stats", ["Profile and account", "Profile"]);
    const viaKeyword = rankDestination("/x", "stats", ["Other", "Stats"]);
    expect(stats).toBe(1);
    expect(profile).toBe(0);
    expect(viaKeyword).toBeLessThan(stats);
    expect(viaKeyword).toBeGreaterThan(0);
  });

  it("ignores accents and case", () => {
    expect(rankDestination("/a", "ESTAD", ["Estadísticas"])).toBe(1);
  });
});
