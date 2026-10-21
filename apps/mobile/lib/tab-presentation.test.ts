import { CAPABILITIES } from "@hackos/shared/capabilities";
import { tabPresentation } from "./tab-presentation";

describe("responsive overflow destinations (H55)", () => {
  const caps = [CAPABILITIES.ACTIVITY_SCAN];
  it("removes the hub when the sidebar fits every destination", () => {
    const result = tabPresentation(caps, { hasQueueItems: true }, 6, 6);
    expect(result.overflow).toEqual([]);
    expect(result.visible).toContain("account");
    expect(result.visible).toContain("diary");
  });
  it("never repeats a visible destination in overflow after resizing", () => {
    for (const [direct, without] of [
      [3, 4],
      [4, 5],
      [6, 6],
    ]) {
      const result = tabPresentation(caps, { hasQueueItems: true }, direct, without);
      expect(result.overflow.some((key) => result.visible.includes(key))).toBe(false);
      expect(new Set([...result.visible, ...result.overflow]).size).toBe(6);
    }
  });
  it("shows a lone overflow destination as a tab instead of a one-item menu", () => {
    const result = tabPresentation(caps, { hasQueueItems: true }, 5, 5);
    expect(result.overflow).toEqual([]);
    expect(result.visible).toHaveLength(6);
    expect(result.withoutOverflow).toBe(6);
  });
  it("keeps the menu when two or more destinations remain", () => {
    const result = tabPresentation(caps, { hasQueueItems: true }, 4, 5);
    expect(result.overflow.length).toBeGreaterThanOrEqual(2);
  });
});
