import { foldPanes } from "./fold-region";

describe("foldPanes", () => {
  it("splits the window above and below a horizontal fold", () => {
    expect(foldPanes({ x: 0, y: 420, width: 466, height: 40 }, 840)).toEqual({
      top: { y: 0, height: 420 },
      bottom: { y: 460, height: 380 },
    });
  });

  it("does not split for a vertical fold, no fold, or panes too small to use", () => {
    expect(foldPanes({ x: 400, y: 0, width: 40, height: 840 }, 840)).toBeNull();
    expect(foldPanes(null, 840)).toBeNull();
    expect(foldPanes({ x: 0, y: 60, width: 466, height: 40 }, 840)).toBeNull();
  });
});
