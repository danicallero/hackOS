import {
  effectiveSideInsets,
  NO_SIDE_REGION,
  SIDE_REGION_MIN_SIZE,
  sideRegionForInsets,
} from "./side-region";

describe("side region", () => {
  it("finds the reserved column from the asymmetric insets", () => {
    expect(sideRegionForInsets({ left: 0, right: 84 })).toEqual({ edge: "right", size: 84 });
    expect(sideRegionForInsets({ left: 84, right: 0 })).toEqual({ edge: "left", size: 84 });
  });

  it("keeps every bar horizontal without one", () => {
    expect(sideRegionForInsets({ left: 0, right: 0 })).toEqual(NO_SIDE_REGION);
    // A phone in landscape with a notch cut-out is not a reserved column.
    expect(sideRegionForInsets({ left: 47, right: 47 })).toEqual(NO_SIDE_REGION);
    expect(sideRegionForInsets({ left: 0, right: SIDE_REGION_MIN_SIZE - 1 })).toEqual(
      NO_SIDE_REGION,
    );
  });
});

describe("effectiveSideInsets", () => {
  it("adds the system's column on the reported edge when the insets do not report it", () => {
    expect(effectiveSideInsets({ left: 0, right: 0 }, "left")).toEqual({ left: 64, right: 0 });
    expect(effectiveSideInsets({ left: 0, right: 0 }, "right")).toEqual({ left: 0, right: 64 });
  });

  it("leaves reported insets and a missing edge alone", () => {
    expect(effectiveSideInsets({ left: 0, right: 84 }, "right")).toEqual({ left: 0, right: 84 });
    expect(effectiveSideInsets({ left: 0, right: 0 }, null)).toEqual({ left: 0, right: 0 });
  });
});
