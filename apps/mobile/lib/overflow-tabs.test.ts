import { overflowMenuPlacement } from "./overflow-tabs";

describe("overflowMenuPlacement", () => {
  const window = { width: 412, height: 900 };

  it("opens leftwards from a bottom-bar trigger on the right", () => {
    expect(overflowMenuPlacement({ x: 340, y: 800, width: 64 }, window, 230, 8)).toEqual({
      bottom: 108,
      left: 174,
    });
  });

  it("opens rightwards from a trigger in a left-hand vertical bar, inside the window", () => {
    const placement = overflowMenuPlacement({ x: 16, y: 700, width: 52 }, window, 230, 8);
    expect(placement.left).toBe(16);
    expect(placement.left + 230).toBeLessThanOrEqual(window.width);
  });

  it("never leaves the window, even narrower than the card", () => {
    expect(
      overflowMenuPlacement({ x: 100, y: 500, width: 52 }, { width: 200, height: 600 }, 230, 8),
    ).toMatchObject({ left: 8 });
  });
});
