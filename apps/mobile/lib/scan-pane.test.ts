import {
  backAction,
  collapseProgress,
  detailBandOpacity,
  nextSelection,
  parseScanUserId,
  peopleDestination,
  scanDestination,
  selectionFromParams,
  selectionKey,
} from "@/lib/scan-pane";

describe("scan pane decisions (H22, H55)", () => {
  it("opens the person in the pane only in two panes", () => {
    expect(scanDestination(true)).toBe("pane");
    expect(scanDestination(false)).toBe("route");
  });

  it("parses person ids from route params", () => {
    expect(parseScanUserId("42")).toBe(42);
    expect(parseScanUserId(["7", "8"])).toBe(7);
    for (const bad of [undefined, "", "0", "-3", "1.5", "abc", "12x"]) {
      expect(parseScanUserId(bad)).toBeNull();
    }
  });

  it("builds a selection from deep-link params, keeping the history focus", () => {
    expect(selectionFromParams({})).toBeNull();
    expect(selectionFromParams({ personId: "9" })).toEqual({ userId: 9 });
    expect(selectionFromParams({ personId: "9", focusLogId: "5", focusSource: "door" })).toEqual({
      userId: 9,
      focusLogId: "5",
      focusSource: "door",
    });
  });

  it("keeps the same selection object when the person does not change", () => {
    const current = { userId: 1 };
    expect(nextSelection(current, { userId: 1 })).toBe(current);
    expect(nextSelection(current, { userId: 2 })).toEqual({ userId: 2 });
    expect(nextSelection(null, { userId: 2 })).toEqual({ userId: 2 });
  });

  it("opens the people finder over the reader only in two panes", () => {
    expect(peopleDestination(true)).toBe("overlay");
    expect(peopleDestination(false)).toBe("route");
  });

  it("closes the finder on back before clearing the pane", () => {
    const selected = { userId: 1 };
    expect(backAction(true, true, selected)).toBe("close-people");
    expect(backAction(true, false, selected)).toBe("clear-selection");
    expect(backAction(true, false, null)).toBe("system");
    expect(backAction(false, true, selected)).toBe("system");
  });

  it("remounts the profile per person and per focused record", () => {
    expect(selectionKey({ userId: 1 })).not.toBe(selectionKey({ userId: 2 }));
    expect(selectionKey({ userId: 1 })).not.toBe(
      selectionKey({ userId: 1, focusLogId: "3", focusSource: "door" }),
    );
  });

  it("fades the top backing in over the first scroll points", () => {
    expect(detailBandOpacity(-10)).toBe(0);
    expect(detailBandOpacity(8)).toBe(0.5);
    expect(detailBandOpacity(400)).toBe(1);
  });

  it("collapses the finder title between rest and a short scroll", () => {
    expect(collapseProgress(-20)).toBe(0);
    expect(collapseProgress(8)).toBe(0);
    expect(collapseProgress(24)).toBe(0.5);
    expect(collapseProgress(200)).toBe(1);
  });
});
