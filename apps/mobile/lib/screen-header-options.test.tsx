jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));

import {
  filterMenuBarItem,
  queueStatusBarItem,
  STATUS_LABEL_MIN_PANE_WIDTH,
  statusShowsLabel,
} from "@/lib/pane-header-items";
import { paneRootHeaderOptions, screenTitleElement } from "@/lib/screen-header-options";
import { SCREEN_TITLE } from "@/theme/screen-title";

/**
 * The checks react-native-screens' `processBarButtonItems` runs on every bar item (expo-router
 * `useHeaderConfigProps`): anything else throws "Invalid item type" and red-screens the app.
 */
function validateBarItems(items: unknown[]) {
  for (const item of items as Array<Record<string, unknown>>) {
    expect(item && typeof item === "object" && !Array.isArray(item)).toBe(true);
    expect(["custom", "spacing", "button", "menu"]).toContain(item.type);
    if (item.type === "spacing") expect(item.spacing).not.toBeNull();
    if (item.type === "menu") expect(item.menu).toBeTruthy();
    if (item.type === "custom") expect(item.element).toBeTruthy();
    // A React element (or any cyclic object) in the array is the crash this guards against.
    expect(() =>
      JSON.stringify(item, (_key, value) => (typeof value === "function" ? undefined : value)),
    ).not.toThrow();
  }
}

describe("pane header options (H55)", () => {
  it("draws the title as plain SCREEN_TITLE text without a shared glass capsule", () => {
    const options = paneRootHeaderOptions({ title: "Scanner", trailing: [] });
    const [title] = options.unstable_headerLeftItems() as Array<{
      element: { props: { style: unknown; children: unknown } };
      hidesSharedBackground: boolean;
    }>;
    expect(title?.hidesSharedBackground).toBe(true);
    expect(title?.element.props.style).toMatchObject(SCREEN_TITLE);
    expect(title?.element.props.children).toBe("Scanner");
    expect(options.headerShadowVisible).toBe(false);
    expect(options.title).toBe("");
  });

  it("uses the same title element as every other top-level title", () => {
    expect((screenTitleElement("Scanner").props as { style: unknown }).style).toMatchObject({
      fontSize: SCREEN_TITLE.fontSize,
      fontWeight: SCREEN_TITLE.fontWeight,
      lineHeight: SCREEN_TITLE.lineHeight,
    });
  });

  it("gives every trailing action its own glass circle, with a gap between", () => {
    const status = queueStatusBarItem({ hasAttention: false, label: "Ready", onPress: jest.fn() });
    const filter = filterMenuBarItem({
      accessibilityLabel: "Filter",
      active: false,
      onSelect: jest.fn(),
      rows: [{ id: "all", label: "All", selected: true }],
    });
    const items = paneRootHeaderOptions({ title: "x", trailing: [filter, status] })
      .unstable_headerRightItems()
      .map((item) => item.type);
    expect(items).toEqual(["menu", "spacing", "button"]);
    validateBarItems(
      paneRootHeaderOptions({ title: "x", trailing: [filter, status] }).unstable_headerRightItems(),
    );
    validateBarItems(
      paneRootHeaderOptions({ title: "x", trailing: [] }).unstable_headerLeftItems(),
    );
    // Actions keep their glass: only the title item hides its shared background.
    for (const item of [filter, status]) expect(item).not.toHaveProperty("hidesSharedBackground");
  });

  it("builds a real button item for the status and a menu item for the role filter", () => {
    const onPress = jest.fn();
    const status = queueStatusBarItem({ hasAttention: true, label: "Attention", onPress });
    expect(status).toMatchObject({
      type: "button",
      label: "Attention",
      icon: { type: "sfSymbol", name: "exclamationmark.triangle.fill" },
    });
    status.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);

    const onSelect = jest.fn();
    const filter = filterMenuBarItem({
      accessibilityLabel: "Filter",
      active: true,
      onSelect,
      rows: [
        { id: "all", label: "All", selected: false },
        { id: "role:Staff", label: "Staff", selected: true },
      ],
    });
    expect(filter.type).toBe("menu");
    expect(filter.menu.items.map((item) => item.state)).toEqual(["off", "on"]);
    filter.menu.items[1]?.onPress();
    expect(onSelect).toHaveBeenCalledWith("role:Staff");
    expect(queueStatusBarItem({ hasAttention: false, label: "Ready", onPress }).icon?.name).toBe(
      "arrow.triangle.2.circlepath",
    );
  });

  it("shows the status label in a wide pane and only its symbol in a narrow one", () => {
    expect(statusShowsLabel(STATUS_LABEL_MIN_PANE_WIDTH, false)).toBe(true);
    expect(statusShowsLabel(STATUS_LABEL_MIN_PANE_WIDTH - 1, false)).toBe(false);
    expect(statusShowsLabel(900, true)).toBe(false);
    const wide = queueStatusBarItem({
      hasAttention: false,
      label: "Ready",
      onPress: jest.fn(),
      showLabel: true,
    });
    expect(wide.label).toBe("Ready");
    expect(wide.icon).toBeUndefined();
  });
});
