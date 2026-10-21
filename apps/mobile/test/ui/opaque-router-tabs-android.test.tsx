/**
 * Android tab-bar behavior: scanner system bars and the account photo
 * (H55, #934). The unread indicator moved from a tab to the Schedule bell
 * (H51), so there is no notifications tab here anymore.
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
jest.mock("expo-status-bar", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    StatusBar: ({ style }: { style: string }) =>
      ReactLib.createElement(Native.View, { style, testID: "scanner-status-bar" }),
  };
});
jest.mock("expo-navigation-bar", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    NavigationBar: ({ style }: { style: string }) =>
      ReactLib.createElement(Native.View, { style, testID: "scanner-navigation-bar" }),
  };
});
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
      "requireExternalGestureToFail",
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
const mockMenuActions: { current: string[] } = { current: [] };
jest.mock("@expo/ui/community/menu", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    MenuView: ({ children, actions }: { children: unknown; actions?: { id: string }[] }) => {
      mockMenuActions.current = (actions ?? []).map(({ id }) => id);
      return ReactLib.createElement(Native.View, null, children);
    },
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
jest.mock("@/lib/api", () => ({ getCurrentSessionCookie: () => "session=abc" }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        tabAccount: "Account",
        tabDiary: "Diary",
        tabActivities: "Activities",
        tabNotifications: "Notifications",
        tabOthers: "Others",
        tabQueue: "Queue",
        tabQueueOperations: "Operations",
        tabScan: "Scan",
        tabSchedule: "Schedule",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/operations-navigation", () => ({
  ...jest.requireActual("@/lib/operations-navigation"),
  resolveOperationsNavigationAction: () => "replace",
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
const mockPrimaryTabs = jest.fn(() => ["schedule", "queue", "diary", "account"]);
const mockOverflowTabs = jest.fn((): string[] => []);
jest.mock("@/lib/tabs", () => ({
  primaryTabs: () => mockPrimaryTabs(),
  overflowTabs: () => mockOverflowTabs(),
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

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Native from "react-native";
import { OpaqueRouterTabs } from "@/components/opaque-router-tabs";

const DEFAULT_PROPS = {
  capabilities: [],
  hasQueueItems: false,
};

async function renderTabs() {
  return render(<OpaqueRouterTabs {...DEFAULT_PROPS} />);
}

describe("OpaqueRouterTabs — Android system bars", () => {
  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    mockUsePathname.mockReturnValue("/(tabs)/schedule");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("uses automatic system bars on scanner and activity routes", async () => {
    const rendered = await renderTabs();
    expect(screen.getByTestId("scanner-status-bar").props.style).toBe("auto");
    expect(screen.getByTestId("scanner-navigation-bar").props.style).toBe("auto");

    await act(async () => {
      mockUsePathname.mockReturnValue("/(tabs)/scan");
      rendered.rerender(<OpaqueRouterTabs {...DEFAULT_PROPS} />);
    });
    expect(screen.getByTestId("scanner-status-bar").props.style).toBe("auto");
    expect(screen.getByTestId("scanner-navigation-bar").props.style).toBe("auto");

    await act(async () => {
      mockUsePathname.mockReturnValue("/(tabs)/activities/42");
      rendered.rerender(<OpaqueRouterTabs {...DEFAULT_PROPS} />);
    });
    expect(screen.getByTestId("scanner-status-bar").props.style).toBe("auto");

    await act(async () => {
      mockUsePathname.mockReturnValue("/(tabs)/activities/people");
      rendered.rerender(<OpaqueRouterTabs {...DEFAULT_PROPS} />);
    });
    expect(screen.getByTestId("scanner-status-bar").props.style).toBe("auto");
    expect(screen.getByTestId("scanner-navigation-bar").props.style).toBe("auto");
  });
});

describe("OpaqueRouterTabs — account photo (#934)", () => {
  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    mockUsePathname.mockReturnValue("/(tabs)/schedule");
  });

  it("shows the signed-in person's photo instead of the Account symbol", async () => {
    await render(
      <OpaqueRouterTabs
        {...DEFAULT_PROPS}
        account={{ name: "Ada Lovelace", image: "/api/users/7/photo?v=abc" }}
      />,
    );
    const tab = screen.getByTestId("opaque-tab-account");
    expect(tab).toBeTruthy();
    expect(screen.queryByTestId("symbol-account_circle")).toBeNull();
    // The signed-in person's own photo is kept on disk to show offline;
    // expo-image sends the Cookie header on Android (React Native's Image dropped it).
    const photo = await screen.findByTestId("account-tab-avatar-photo", {
      includeHiddenElements: true,
    });
    expect(photo.props.source[0]).toMatchObject({
      uri: "https://api.test/api/users/7/photo?v=abc",
      headers: { Cookie: "session=abc" },
    });
    expect(photo.props.cachePolicy).toBe("disk");
  });

  it("keeps the Account symbol without a photo", async () => {
    await render(<OpaqueRouterTabs {...DEFAULT_PROPS} account={{ name: "Ada", image: null }} />);
    expect(screen.getByTestId("symbol-account_circle")).toBeTruthy();
  });

  describe("when Account sits behind Others", () => {
    beforeEach(() => {
      mockPrimaryTabs.mockReturnValue(["schedule", "queue", "activities", "scan"]);
      mockOverflowTabs.mockReturnValue(["diary", "account"]);
    });
    afterEach(() => {
      mockPrimaryTabs.mockReturnValue(["schedule", "queue", "diary", "account"]);
      mockOverflowTabs.mockReturnValue([]);
    });

    it.each([
      "/(tabs)/others/account",
      "/(tabs)/others/wallet",
      "/(tabs)/others/notification-settings",
      "/(tabs)/others/notification-settings/reminders",
      "/(tabs)/others/stands",
    ])("shows the account photo in the Others circle on %s", async (path) => {
      mockUsePathname.mockReturnValue(path);
      await render(
        <OpaqueRouterTabs
          {...DEFAULT_PROPS}
          account={{ name: "Ada Lovelace", image: "/api/users/7/photo?v=abc" }}
        />,
      );
      // The photo fills the circle itself: no selection ring around a tab-sized icon.
      expect(
        await screen.findByTestId("account-overflow-avatar-photo", { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(
        screen.queryByTestId("account-tab-avatar", { includeHiddenElements: true }),
      ).toBeNull();
    });

    it("keeps the Others symbol while another destination is open", async () => {
      await render(
        <OpaqueRouterTabs
          {...DEFAULT_PROPS}
          account={{ name: "Ada Lovelace", image: "/api/users/7/photo?v=abc" }}
        />,
      );
      expect(
        screen.queryByTestId("account-tab-avatar", { includeHiddenElements: true }),
      ).toBeNull();
    });
  });
});

describe("OpaqueRouterTabs — direct Account tab selection", () => {
  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    mockPrimaryTabs.mockReturnValue(["schedule", "account"]);
    mockOverflowTabs.mockReturnValue(["queue"]);
  });
  afterEach(() => {
    mockPrimaryTabs.mockReturnValue(["schedule", "queue", "diary", "account"]);
    mockOverflowTabs.mockReturnValue([]);
  });

  it.each([
    ["/(tabs)/others/account", true],
    ["/(tabs)/others/wallet", true],
    ["/(tabs)/others/notification-settings", true],
    ["/(tabs)/others/queue", false],
    ["/(tabs)/schedule", false],
  ])("on %s the Account tab selected = %s", async (path, selected) => {
    mockUsePathname.mockReturnValue(path);
    await renderTabs();
    expect(screen.getByTestId("opaque-tab-account").props.accessibilityState.selected).toBe(
      selected,
    );
  });
});

describe("OpaqueRouterTabs — Account is the bottom-most Others entry (H55)", () => {
  const SETS: [string, string[]][] = [
    ["operator", ["diary", "operations", "account"]],
    ["queue operator", ["queue", "diary", "account"]],
    ["participant with queue", ["queue", "diary", "account"]],
  ];
  beforeEach(() => {
    mockPrimaryTabs.mockReturnValue(["schedule", "scan", "activities"]);
    mockUsePathname.mockReturnValue("/(tabs)/schedule");
    // The trigger's anchor comes from measureInWindow, absent in the host mock.
    (Native.View.prototype as unknown as Record<string, unknown>).measureInWindow = (
      cb: (x: number, y: number, w: number) => void,
    ) => cb(300, 700, 64);
  });
  afterEach(() => {
    delete (Native.View.prototype as unknown as Record<string, unknown>).measureInWindow;
    mockPrimaryTabs.mockReturnValue(["schedule", "queue", "diary", "account"]);
    mockOverflowTabs.mockReturnValue([]);
  });

  it.each(SETS)("Android lists Account last for %s", async (_n, overflow) => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    mockOverflowTabs.mockReturnValue(overflow);
    await renderTabs();
    await fireEvent.press(screen.getByTestId("opaque-others-menu"));
    const names = ["Queue", "Diary", "Operations", "Account"];
    const texts = screen
      .getAllByText(/^(Queue|Diary|Operations|Account)$/, { includeHiddenElements: true })
      .map((n) => n.props.children as string)
      .filter((t) => names.includes(t));
    expect(texts.at(-1)).toBe("Account");
  });

  it.each(
    SETS,
  )("iOS passes Account first (rendered at the bottom) for %s", async (_n, overflow) => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    mockOverflowTabs.mockReturnValue(overflow);
    await renderTabs();
    expect(mockMenuActions.current[0]).toBe("account");
    // The first overflow destination takes the fourth direct cell.
    expect([...mockMenuActions.current].reverse()).toEqual(overflow.slice(1));
  });
});

describe("OpaqueRouterTabs — Dynamic Type", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/(tabs)/schedule");
  });

  it("caps tab labels and shrinks them to fit instead of clipping the fixed bar", async () => {
    const { CHROME_MAX_FONT_SIZE_MULTIPLIER, CHROME_MIN_FONT_SCALE } =
      require("@/theme/dynamic-type") as typeof import("@/theme/dynamic-type");
    await renderTabs();

    const label = screen.getByText("Schedule");
    expect(label.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SIZE_MULTIPLIER);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.minimumFontScale).toBe(CHROME_MIN_FONT_SCALE);
    expect(label.props.numberOfLines).toBe(1);
  });
});
