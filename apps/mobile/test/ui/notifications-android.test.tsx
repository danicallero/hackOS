import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Platform, StyleSheet } from "react-native";

jest.mock("expo-router", () => ({
  useScrollToTop: () => {},
}));

const mockApiFetch = jest.fn();
let resolveNextPage: ((value: { items: unknown[]; total: number }) => void) | null = null;

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
}));
jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    EmptyState: ({ title }: { title: string }) => ReactLib.createElement(Native.Text, null, title),
    Section: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
    Separator: () => ReactLib.createElement(Native.View),
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
// Indirect call: the factory runs while the screen module is being
// required, which can precede this file's own `const` initialisation.
jest.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string, values?: { count?: string; total?: string }) => {
      if (key === "notificationsShowingLatest") {
        return `Showing ${values?.count} of ${values?.total}`;
      }
      return (
        (
          {
            notificationsPullToLoadMore: "Load more messages",
            notificationsMessages: "Messages",
            notificationsPreferences: "Preferences",
            notificationsUnreadOnly: "Unread only",
            tabNotifications: "Notifications",
          } as Record<string, string>
        )[key] ?? key
      );
    },
  }),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: [] } }),
}));
jest.mock("@/lib/notification-events", () => ({
  emitNotificationChange: jest.fn(),
  subscribeToCategory: () => () => {},
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

import NotificationsScreen from "@/app/(tabs)/notifications";
import { renderMobile } from "./render";

const page = (start: number) => ({
  items: Array.from({ length: 20 }, (_, index) => ({
    id: start + index,
    category: "announcements",
    payload: { subject: `Notification ${start + index}` },
    status: "sent",
    sent_at: null,
    read_at: null,
    created_at: "2026-08-22T12:00:00.000Z",
  })),
  total: 40,
});

beforeEach(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
  resolveNextPage = null;
  mockApiFetch.mockImplementation((path: string) => {
    if (path.includes("offset=20")) {
      return new Promise((resolve) => {
        resolveNextPage = resolve;
      });
    }
    if (path.startsWith("/api/me/notifications?")) return Promise.resolve(page(1));
    if (path === "/api/me/notification-preferences") {
      return Promise.resolve({ channels: ["push"], mandatoryCategories: [], overrides: [] });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("Android notification pagination (H51)", () => {
  it("offers an accessible tap fallback and never starts duplicate page loads", async () => {
    await renderMobile(<NotificationsScreen />);

    const loadMore = await screen.findByRole("button", { name: "Load more messages" });
    // The queried element is the host view, so its style is already resolved.
    expect(StyleSheet.flatten(loadMore.props.style).height).toBe(44);

    await act(async () => {
      fireEvent.press(loadMore);
      fireEvent.press(loadMore);
    });

    expect(
      mockApiFetch.mock.calls.filter(([path]) => String(path).includes("offset=20")),
    ).toHaveLength(1);

    await act(async () => {
      resolveNextPage?.(page(21));
    });
    await waitFor(() => expect(screen.getByText("Notification 21")).toBeTruthy());
  });
});
