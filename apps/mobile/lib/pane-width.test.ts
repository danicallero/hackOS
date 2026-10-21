import {
  badgeFitsBesideTitle,
  columnCount,
  DETAIL_PANE_MIN_WIDTH,
  listPaneWidth,
  resolveListPaneWidth,
  tileWidth,
} from "@/lib/pane-width";
import { participantLayout } from "@/theme/layout-participant";

describe("listPaneWidth", () => {
  it("is a share of the window between 340 and 460", () => {
    expect(listPaneWidth(1000)).toBe(380);
    expect(listPaneWidth(1180)).toBe(448);
    expect(listPaneWidth(1600)).toBe(460);
  });

  it("never leaves the detail pane under its minimum", () => {
    expect(listPaneWidth(640)).toBe(320);
    expect(640 - listPaneWidth(640)).toBeGreaterThanOrEqual(DETAIL_PANE_MIN_WIDTH);
    expect(listPaneWidth(673)).toBe(340);
  });

  it("holds a floor in tiny windows", () => {
    expect(listPaneWidth(400)).toBe(280);
  });

  it("keeps clear of a crease gutter", () => {
    expect(listPaneWidth(700, 40)).toBe(340);
  });
});

describe("resolveListPaneWidth", () => {
  it("keeps the page before a book crease", () => {
    expect(resolveListPaneWidth(951, { listWidth: 470, gutter: 12 }, { x: 470 })).toBe(470);
  });

  it("uses the share rule otherwise", () => {
    expect(resolveListPaneWidth(1000, { listWidth: 380, gutter: 0 }, null)).toBe(380);
  });
});

describe("columnCount", () => {
  it("fits as many minimum-width tiles as the width allows", () => {
    expect(columnCount(358, 300, 12)).toBe(1);
    expect(columnCount(624, 300, 12)).toBe(2);
    expect(columnCount(936, 300, 12)).toBe(3);
  });

  it("respects the maximum and never returns zero", () => {
    expect(columnCount(2000, 300, 12, 3)).toBe(3);
    expect(columnCount(100, 300, 12)).toBe(1);
    expect(columnCount(0, 300, 12)).toBe(1);
  });
});

describe("tileWidth", () => {
  it("splits the width after the gaps", () => {
    expect(tileWidth(624, 2, 12)).toBe(306);
    expect(tileWidth(300, 1, 12)).toBe(300);
  });
});

describe("badgeFitsBesideTitle", () => {
  it("stacks the badge in a narrow pane or at accessibility text sizes", () => {
    expect(badgeFitsBesideTitle(150, false)).toBe(false);
    expect(badgeFitsBesideTitle(260, false)).toBe(true);
    expect(badgeFitsBesideTitle(260, true)).toBe(false);
  });
});

describe("participantLayout", () => {
  it("uses equal gutters and bounds forms narrower than lists", () => {
    const form = participantLayout(1000, 1, "form");
    const list = participantLayout(1000, 1, "list");
    expect(form.content.paddingHorizontal).toBe(32);
    expect(form.columnWidth).toBe(624);
    expect(list.columnWidth).toBe(720);
    expect(participantLayout(1000, 1, "grid").columnWidth).toBe(960);
    expect(participantLayout(400, 1, "list").columnWidth).toBe(400);
  });

  it("derives tile columns from the inner width and flags accessibility sizes", () => {
    const grid = participantLayout(1000, 1, "grid");
    expect(grid.columns(280, 12)).toBe(3);
    expect(grid.tile(3, 12)).toBeLessThanOrEqual(grid.innerWidth / 3);
    expect(participantLayout(390, 2, "list").stacked).toBe(true);
    expect(participantLayout(390, 1, "list").stacked).toBe(false);
  });
});
