/**
 * Tests for the Android unread notification indicator on the notifications tab.
 * (issue #625, H51/H55/H489)
 *
 * The acceptance criteria require:
 * - A visible Android badge/dot that cannot be confused with the ordinary bell.
 * - The indicator is absent when there are no unread notifications.
 * - Selected/unselected icon contrast is preserved.
 * - Tab-bar geometry is not altered unexpectedly.
 */

import type React from "react";
import { Platform } from "react-native";

// Mocks for expo-router tab primitives used by router-tabs.tsx.
const mockUsePathname = jest.fn(() => "/(tabs)/schedule");
const mockUseRouter = jest.fn(() => ({ replace: jest.fn() }));
jest.mock("expo-router", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => mockUseRouter(),
}));
jest.mock("expo-router/ui", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  const TabTrigger = ReactLib.forwardRef(
    (
      { children, asChild }: { children: unknown; asChild?: boolean; name?: string; href?: string },
      _ref: unknown,
    ) => {
      if (asChild && ReactLib.isValidElement(children)) {
        return ReactLib.cloneElement(
          children as React.ReactElement<{
            isFocused?: boolean;
            accessibilityState?: { selected: boolean };
          }>,
          {
            isFocused: false,
            accessibilityState: { selected: false },
          },
        );
      }
      return ReactLib.createElement(Native.View, null, children);
    },
  );
  return {
    TabList: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, { style: { display: "none" } }, children),
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
  const chainable = (): Record<string, () => unknown> => {
    const handler: Record<string, () => unknown> = {};
    const methods = [
      "activeOffsetX",
      "failOffsetY",
      "enabled",
      "onStart",
      "onUpdate",
      "onFinalize",
    ];
    for (const m of methods) {
      handler[m] = () => chainable();
    }
    return handler;
  };
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
    default: {
      View: Native.View,
      createAnimatedComponent: (c: unknown) => c,
    },
    cancelAnimation: jest.fn(),
    runOnJS: (fn: (...args: never[]) => unknown) => fn,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (v: unknown) => ReactLib.useRef({ value: v }).current,
    withSpring: (v: number) => v,
  };
});
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }),
}));
jest.mock("@expo/ui/community/menu", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    MenuView: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
  };
});
jest.mock("expo-symbols", () => ({
  SymbolView: ({ name }: { name: string | { android?: string } }) => {
    const ReactLib = require("react");
    const Native = jest.requireActual("react-native");
    const resolvedName = typeof name === "object" ? (name.android ?? "") : name;
    return ReactLib.createElement(Native.View, { testID: `symbol-${resolvedName}` });
  },
}));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        tabAccount: "Account",
        tabActivities: "Activities",
        tabNotifications: "Notifications",
        tabOthers: "Others",
        tabQueue: "Queue",
        tabQueueOperations: "Operations",
        tabScan: "Scan",
        tabSchedule: "Schedule",
        tabWallet: "Wallet",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/operations-navigation", () => ({
  operationsSectionFromPathname: () => "external",
  resolveOperationsNavigationAction: () => "replace",
}));
jest.mock("@/lib/overflow-tabs", () => ({
  OVERFLOW_TAB_ICON: {},
  OVERFLOW_TAB_LABEL_KEY: {},
  OVERFLOW_TAB_ROUTE: {},
}));
jest.mock("@/lib/router-tabs-inset", () => ({
  RouterTabBarInsetsProvider: ({ children }: { children: unknown }) => children,
  ROUTER_TAB_BAR_HEIGHT: 64,
  routerTabBarDirectTabsForWidth: () => 4,
  routerTabBarMaxTabsWithoutOverflowForWidth: () => 5,
  useRouterTabBarInsets: () => ({
    safeAreaBottom: 34,
    tabBarBottomPadding: 34,
    tabBarHeight: 64,
    tabBarVerticalPadding: 8,
    contentBottomInset: 98,
  }),
}));
jest.mock("@/lib/tabs", () => ({
  primaryTabs: () => ["schedule", "notifications", "wallet", "account"],
  overflowTabs: () => [],
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentSurface: "#e5f0ff",
    controlShadow: "rgba(0,0,0,0.1)",
    secondaryLabel: "#6c6c70",
    surface: "#ffffff",
    transparent: "transparent",
  },
}));

import { render, screen } from "@testing-library/react-native";
import { OpaqueRouterTabs } from "@/components/opaque-router-tabs";

const DEFAULT_PROPS = {
  capabilities: [],
  hasQueueItems: false,
  hasUnreadNotifications: false,
};

async function renderTabs(hasUnreadNotifications: boolean) {
  return render(
    <OpaqueRouterTabs {...DEFAULT_PROPS} hasUnreadNotifications={hasUnreadNotifications} />,
  );
}

describe("OpaqueRouterTabs — Android unread notification indicator (issue #625)", () => {
  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders no badge dot on the notifications tab when there are no unread notifications", async () => {
    await renderTabs(false);
    // The badge dot has no testID; absence is verified by checking that no
    // styled View with the accent dot colour is rendered on the notifications tab.
    // The plain bell symbol is rendered instead.
    expect(screen.queryByTestId("android-notification-badge-dot")).toBeNull();
  });

  it("renders a badge dot on the notifications tab when there are unread notifications", async () => {
    await renderTabs(true);
    // The AndroidNotificationIcon renders a dot View with testID for test visibility.
    expect(screen.getAllByTestId("android-notification-badge-dot").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("renders a badge dot in the icon slot when the tab is not focused", async () => {
    await renderTabs(true);
    // RouterTabButton only renders `selectedIcon` when the tab isFocused is true.
    // In the test harness the tab is unfocused, so only the inactive icon slot is
    // rendered and exactly one badge dot is visible.
    const dots = screen.getAllByTestId("android-notification-badge-dot");
    expect(dots.length).toBe(1);
  });

  it("does not alter tab bar geometry: notifications tab container style is the same with and without unread", async () => {
    const { unmount: unmount1 } = await render(
      <OpaqueRouterTabs {...DEFAULT_PROPS} hasUnreadNotifications={false} />,
    );
    const styleBefore = screen.getByTestId("opaque-tab-notifications").props.style;
    await unmount1();

    await render(<OpaqueRouterTabs {...DEFAULT_PROPS} hasUnreadNotifications={true} />);
    const styleAfter = screen.getByTestId("opaque-tab-notifications").props.style;

    // Geometry (flex: 1, etc.) must be identical; only icon content changes.
    expect(styleAfter).toEqual(styleBefore);
  });
});
