import { act, fireEvent, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Platform } from "react-native";

// The unread filter is a header action; capture it to press it like the header would.
const mockNavOptions: { headerRight?: () => ReactElement } = {};
jest.mock("expo-router", () => ({
  useNavigation: () => ({
    setOptions: (options: object) => Object.assign(mockNavOptions, options),
  }),
  useRouter: () => ({ push: () => {} }),
  useScrollToTop: () => {},
}));

const mockApiFetch = jest.fn();

jest.mock("react-native-reanimated", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: {
      ScrollView: Native.ScrollView,
      View: Native.View,
      createAnimatedComponent: (component: unknown) => component,
    },
    createAnimatedComponent: (component: unknown) => component,
    runOnJS: (fn: (...args: never[]) => unknown) => fn,
    useAnimatedProps: (factory: () => unknown) => factory(),
    useAnimatedScrollHandler: (handlers: unknown) => handlers,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: unknown) => ReactLib.useRef({ value }).current,
  };
});
jest.mock("react-native-svg", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
    Circle: Native.View,
  };
});
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("expo-router/stack", () => ({ __esModule: true, default: { Toolbar: () => null } }));
jest.mock("@/components/reminders-view", () => ({ RemindersView: () => null }));
jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    EmptyState: ({ title }: { title: string }) => ReactLib.createElement(Native.Text, null, title),
    Section: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
    Separator: () => ReactLib.createElement(Native.View),
    LegacyHeaderIconButton: ({
      accessibilityLabel,
      onPress,
    }: {
      accessibilityLabel: string;
      onPress: () => void;
    }) =>
      ReactLib.createElement(Native.Pressable, {
        accessibilityLabel,
        accessibilityRole: "button",
        onPress,
      }),
  };
});
jest.mock("@/components/RequestFeedback", () => ({
  RequestFeedback: () => null,
}));
jest.mock("@/components/segmented-control", () => ({
  SegmentedControl: () => null,
}));
jest.mock("@/components/stale-data-banner", () => ({
  StaleDataBanner: () => null,
}));
jest.mock("@/components/symbol", () => ({
  SymbolView: () => null,
}));
jest.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      (
        ({
          notificationsEmptyHint: "Nothing here",
          notificationsMessages: "Messages",
          notificationsNoUnread: "No unread notifications",
          notificationsPreferences: "Preferences",
          notificationsUnreadOnly: "Unread only",
          tabNotifications: "Notifications",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: [] } }),
}));
jest.mock("@/lib/notification-events", () => ({
  emitNotificationChange: jest.fn(),
  emitNotificationPreferenceChange: jest.fn(),
  subscribeToCategory: () => () => {},
  subscribeToNotificationPreferenceChanges: () => () => {},
  subscribeToNotificationChanges: () => () => {},
}));
jest.mock("@/lib/server-events", () => ({ subscribeToServerEvent: () => () => {} }));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("@/lib/use-cached-api", () => {
  const ReactLib = require("react");
  return {
    useCachedApi: (_key: string, fetcher: () => Promise<unknown>) => {
      const [data, setData] = ReactLib.useState(null);
      const [loading, setLoading] = ReactLib.useState(false);
      const load = ReactLib.useCallback(async () => {
        setLoading(true);
        setData(await fetcher());
        setLoading(false);
      }, [fetcher]);
      return { data, error: null, loading, load, setData, staleSince: null };
    },
  };
});
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    background: "#f5f5f7",
    destructive: "#d00",
    elevatedSurface: "#fff",
    label: "#171717",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    surface: "#fff",
    tertiaryLabel: "#7c7c80",
    transparent: "transparent",
  },
}));

import NotificationsScreen from "@/components/alerts-screen";
import { renderMobile } from "./render";

const unreadItem = {
  id: 123,
  category: "announcements",
  payload: { subject: "Kickoff moved" },
  status: "sent",
  sent_at: null,
  read_at: null,
  created_at: "2026-08-22T12:00:00.000Z",
};

beforeEach(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  mockApiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "POST" && path === "/api/me/notifications/123/read") {
      return Promise.resolve({ id: 123, read_at: "2026-08-22T12:05:00.000Z" });
    }
    if (path.startsWith("/api/me/notifications?")) {
      return Promise.resolve({ items: [unreadItem], total: 1 });
    }
    if (path === "/api/me/notification-preferences") {
      return Promise.resolve({ channels: ["push"], mandatoryCategories: [], overrides: [] });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("unread-only grace period (H489)", () => {
  it("keeps a just-read notification visible until it is collapsed again", async () => {
    const inbox = await renderMobile(<NotificationsScreen />);

    // Press the header's Unread only action, as the native header would.
    const headerRight = mockNavOptions.headerRight?.() as ReactElement<{
      accessibilityLabel: string;
      onPress: () => void;
    }>;
    expect(headerRight.props.accessibilityLabel).toBe("Unread only");
    await act(async () => {
      headerRight.props.onPress();
    });

    const row = await inbox.findByRole("button", { name: /Kickoff moved/ });

    await act(async () => {
      fireEvent.press(row);
    });
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/me/notifications/123/read",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // Read, but still filtered in — the user hasn't closed it yet.
    expect(inbox.getByText("Kickoff moved")).toBeTruthy();

    await act(async () => {
      fireEvent.press(row);
    });

    await waitFor(() => expect(inbox.queryByText("Kickoff moved")).toBeNull());
    expect(inbox.getByText("No unread notifications")).toBeTruthy();
  });
});
