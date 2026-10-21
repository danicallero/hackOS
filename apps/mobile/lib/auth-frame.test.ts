import { authFrameExtra } from "./auth-frame";

describe("authFrameExtra (H55)", () => {
  const right = { edge: "right", size: 84 } as const;
  it("centres on the window when there is room beside the side column", () => {
    expect(authFrameExtra(844, right, null)).toEqual({ left: 84, right: 0 });
    expect(authFrameExtra(844, { edge: "left", size: 64 }, null)).toEqual({ left: 0, right: 64 });
  });
  it("keeps the form filling the narrower area (portrait foldable, no side column)", () => {
    expect(authFrameExtra(533, right, null)).toEqual({ left: 0, right: 0 });
    expect(authFrameExtra(390, { edge: null, size: 0 }, null)).toEqual({ left: 0, right: 0 });
  });
  it("centres on the first page of a book pose instead of the crease", () => {
    expect(authFrameExtra(844, right, { x: 422, width: 12 })).toEqual({ left: 0, right: 338 });
  });
  it("ignores a page too narrow to hold the form", () => {
    expect(authFrameExtra(844, right, { x: 200, width: 12 })).toEqual({ left: 84, right: 0 });
  });
});
