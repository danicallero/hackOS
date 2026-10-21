import { bookCrease, sameRegion } from "./fold-region";

describe("sameRegion", () => {
  it("treats equal rectangles as unchanged so polling does not rerender", () => {
    const fold = { x: 0, y: 420, width: 466, height: 40 };
    expect(sameRegion(fold, { ...fold })).toBe(true);
    expect(sameRegion(null, null)).toBe(true);
  });

  it("reports a pose change, including a fold appearing or disappearing", () => {
    const fold = { x: 0, y: 420, width: 466, height: 40 };
    expect(sameRegion(fold, { ...fold, y: 430 })).toBe(false);
    expect(sameRegion(fold, null)).toBe(false);
    expect(sameRegion(null, fold)).toBe(false);
  });
});

describe("bookCrease", () => {
  it("reports a fold running top to bottom and ignores a horizontal one", () => {
    expect(bookCrease({ x: 470, y: 0, width: 12, height: 669 })).toEqual({ x: 470, width: 12 });
    expect(bookCrease({ x: 0, y: 420, width: 466, height: 40 })).toBeNull();
    expect(bookCrease(null)).toBeNull();
  });
});
