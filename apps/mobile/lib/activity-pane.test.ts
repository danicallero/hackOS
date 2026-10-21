import { isActivitySelected, parseActivityId, resultCardMaxHeight } from "./activity-pane";

describe("parseActivityId", () => {
  it("reads positive integers, first of a list", () => {
    expect(parseActivityId("7")).toBe(7);
    expect(parseActivityId(["9", "2"])).toBe(9);
  });
  it.each([undefined, "", "0", "-3", "1.5", "abc", "7x", []])("rejects %p", (raw) => {
    expect(parseActivityId(raw as string | undefined)).toBeNull();
  });
});

describe("isActivitySelected", () => {
  it("highlights only beside the pane", () => {
    expect(isActivitySelected(true, 4, 4)).toBe(true);
    expect(isActivitySelected(true, 4, 5)).toBe(false);
    expect(isActivitySelected(true, null, 4)).toBe(false);
    expect(isActivitySelected(false, 4, 4)).toBe(false);
  });
});

describe("resultCardMaxHeight", () => {
  const base = { windowHeight: 800, insetsTop: 20, insetsBottom: 10, tabBarBottomInset: 0 };
  it("measures the window for the full-screen scanner", () => {
    expect(resultCardMaxHeight({ ...base, pane: null })).toBe(730);
  });
  it("measures the pane below its band", () => {
    expect(resultCardMaxHeight({ ...base, pane: { height: 600, band: 72 } })).toBe(488);
  });
  it("falls back to the window before the pane is measured", () => {
    expect(resultCardMaxHeight({ ...base, pane: { height: null, band: 72 } })).toBe(658);
  });
  it("never goes negative in a very short pane", () => {
    expect(resultCardMaxHeight({ ...base, pane: { height: 50, band: 72 } })).toBe(0);
  });
});
