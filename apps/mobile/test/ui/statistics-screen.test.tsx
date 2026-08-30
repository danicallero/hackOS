import { screen, userEvent, waitFor } from "@testing-library/react-native";

const mockPush = jest.fn();
const mockFetchMyScanStats = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useScrollToTop: jest.fn(),
}));
jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    ActionButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      ReactLib.createElement(
        Native.Pressable,
        { accessibilityRole: "button", accessibilityLabel: label, onPress },
        ReactLib.createElement(Native.Text, null, label),
      ),
    InfoRow: ({ label, value }: { label: string; value: string }) =>
      ReactLib.createElement(
        Native.View,
        null,
        ReactLib.createElement(Native.Text, null, label),
        ReactLib.createElement(Native.Text, null, value),
      ),
    Section: ({ title, children }: { title?: string; children: unknown }) =>
      ReactLib.createElement(
        Native.View,
        null,
        title ? ReactLib.createElement(Native.Text, null, title) : null,
        children,
      ),
    Separator: () => ReactLib.createElement(Native.View),
    StatusPill: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.Text, null, children),
  };
});
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({
        statisticsOverview: "Overview",
        statisticsOverviewDescription: "Your scan activity and the tools to review it.",
        statisticsActivityTitle: "Activity summary",
        statisticsActivityFooter: "Counts are based on scans recorded by this account.",
        statisticsTotalScans: "Total scans",
        statisticsPeopleReached: "People reached",
        statisticsLastScan: "Last scan",
        statisticsBreakdownTitle: "By type",
        statisticsHistoryTitle: "History",
        statisticsOpenHistory: "Open scan history",
        statisticsNoScans: "No scans yet",
        scannerNeverSynced: "Never synchronized",
        myStatsAccreditation: "People accredited",
        myStatsPresence: "Door scans logged",
        myStatsActivity: "Activity / meal scans logged",
        statisticsStaffOnly: "Statistics are available to staff accounts only.",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({
    me: { capabilities: ["logistics:stats"] },
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock("@/lib/scan-log", () => ({
  fetchMyScanStats: (...args: unknown[]) => mockFetchMyScanStats(...args),
}));
jest.mock("@/lib/scan-log-navigation", () => ({
  SCAN_LOG_ROUTES: { account: "/(tabs)/others/scan-log" },
}));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({
    errorHistory: [],
    lastSync: "2026-08-29T12:00:00.000Z",
    queue: [],
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    background: "#000000",
    destructive: "#ff453a",
    label: "#ffffff",
    secondaryLabel: "#8e8e93",
    success: "#30d158",
    tertiaryLabel: "#636366",
    warning: "#ff9f0a",
  },
}));

import StatisticsScreen from "@/components/statistics-screen";
import { renderMobile } from "./render";

describe("statistics operations hub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchMyScanStats.mockResolvedValue({
      accreditationCount: 4,
      activityCount: 12,
      lastScanAt: "2026-08-29T11:45:00.000Z",
      presenceCount: 8,
      totalCount: 24,
      uniquePeopleCount: 19,
    });
  });

  it("shows useful totals and links to scan history", async () => {
    const user = userEvent.setup();
    await renderMobile(<StatisticsScreen />);

    await waitFor(() => expect(screen.getByText("24")).toBeTruthy());
    expect(screen.getByText("19")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();

    await user.press(screen.getByRole("button", { name: "Open scan history" }));

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: "/(tabs)/others/scan-log",
      params: { from: "statistics" },
    });
    expect(screen.queryByText("Sync queue")).toBeNull();
  });
});
