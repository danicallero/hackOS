/**
 * Foldable iPhone: the system reserves a side column, so the tab bar stands there,
 * symbol-only and bottom-aligned, on the system's side; elsewhere it stays horizontal.
 */

import type React from "react";

jest.mock("expo-router", () => ({ usePathname: () => "/(tabs)/schedule" }));
jest.mock("expo-router/ui", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  const TabTrigger = ReactLib.forwardRef(
    ({ children, asChild }: { children: unknown; asChild?: boolean }, _ref: unknown) =>
      asChild && ReactLib.isValidElement(children)
        ? ReactLib.cloneElement(children as React.ReactElement<{ isFocused?: boolean }>, {
            isFocused: false,
          })
        : ReactLib.createElement(Native.View, null, children),
  );
  return {
    TabList: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
    TabSlot: () => ReactLib.createElement(Native.View),
    Tabs: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
    TabTrigger,
    useTabTrigger: () => ({ switchTab: jest.fn() }),
  };
});
jest.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children: unknown }) => {
    const ReactLib = require("react");
    const Native = jest.requireActual("react-native");
    return ReactLib.createElement(Native.View, null, children);
  },
  isLiquidGlassAvailable: () => false,
}));
jest.mock("react-native-gesture-handler", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  const chainable = (): Record<string, () => unknown> =>
    new Proxy({}, { get: () => () => chainable() });
  return {
    GestureHandlerRootView: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
    Gesture: { Pan: () => chainable() },
    GestureDetector: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
  };
});
jest.mock("react-native-reanimated", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: { View: Native.View, createAnimatedComponent: (c: unknown) => c },
    cancelAnimation: jest.fn(),
    runOnJS: (fn: (...args: never[]) => unknown) => fn,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (v: unknown) => ReactLib.useRef({ value: v }).current,
    withSpring: (v: number) => v,
  };
});

import { screen, within } from "@testing-library/react-native";
import type { Href } from "expo-router";
import { StyleSheet, View } from "react-native";
import { RouterTabs } from "@/components/router-tabs";
import { NO_SIDE_REGION, SideRegionProvider } from "@/lib/side-region";
import { renderMobile } from "./render";

const theme = {
  label: "#6c6c70",
  selectedLabel: "#007aff",
  selectedSurface: "#e5f0ff",
  surface: "#ffffff",
  transparent: "transparent",
};
const tabs = ["Schedule", "Scanner", "Activities"].map((label) => ({
  href: `/${label.toLowerCase()}` as Href,
  icon: <View testID={`icon-${label}`} />,
  label,
  name: label.toLowerCase(),
}));

async function renderBar(region: Parameters<typeof SideRegionProvider>[0]["value"]) {
  return renderMobile(
    <SideRegionProvider value={region}>
      <RouterTabs
        overflow={<View testID="overflow-content" />}
        tabs={tabs}
        testID="bar"
        theme={theme}
      />
    </SideRegionProvider>,
    { insets: { left: 0, right: 0 } },
  );
}

describe("tab bar on a foldable iPhone", () => {
  it("stands in the right-hand column the system reserves, symbol only", async () => {
    await renderBar({ edge: "right", size: 84 });
    const bar = screen.getByTestId("bar-vertical").parent;
    expect(StyleSheet.flatten(bar?.props.style)).toMatchObject({
      justifyContent: "flex-end",
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      width: 84,
    });
    // Symbols only: the labels survive as accessibility names.
    expect(screen.queryByText("Schedule")).toBeNull();
    expect(screen.getByLabelText("Schedule")).toBeTruthy();
    expect(within(screen.getByTestId("bar-vertical")).getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByTestId("overflow-content")).toBeTruthy();
  });

  it("follows the left edge when the system's column is on the left (Split View, left half)", async () => {
    await renderBar({ edge: "left", size: 84 });
    const bar = screen.getByTestId("bar-vertical").parent;
    expect(StyleSheet.flatten(bar?.props.style)).toMatchObject({ left: 0, width: 84 });
    expect(StyleSheet.flatten(bar?.props.style).right).toBeUndefined();
  });

  it("stays a horizontal, labelled bar without a reserved column (inner display, portrait)", async () => {
    await renderBar(NO_SIDE_REGION);
    expect(screen.queryByTestId("bar-vertical")).toBeNull();
    expect(screen.getByText("Schedule")).toBeTruthy();
  });
});
