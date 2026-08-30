import { act, screen, userEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
const mockSetOptions = jest.fn();
const mockFetchScanLog = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  usePathname: () => "/(tabs)/others/scan-log",
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
    Section: ({ title, children }: { title?: string; children: unknown }) =>
      ReactLib.createElement(
        Native.View,
        null,
        title ? ReactLib.createElement(Native.Text, null, title) : null,
        children,
      ),
    Separator: () => ReactLib.createElement(Native.View),
  };
});
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, string>) =>
      ({
        scanLogTitle: "Scan history",
        scanLogSearchPlaceholder: "Search history",
        scanLogDescription: "Tap a record to open the person and review the related scan.",
        scanLogToday: "Today",
        scanLogEmpty: "No scans recorded yet.",
        scanLogNoMatches: "No matching scans",
        scanLogNoMatchesDescription: "Try a person, activity, door, badge, or note.",
        scanLogOpenProfile: "Open the person's profile",
        scanLogBadge: "Badge",
        scanLogMethodQr: "QR scan",
        scanLogUnknownActivity: "Unknown activity",
        scannerAccreditation: "Badge assigned",
        scannerPresence: "Door scan",
        scannerActivity: "Activity scan",
        scannerIn: "Entry",
        scannerOut: "Exit",
        scanLogLoadMore: "Load more",
        scanLogUnknownPerson: `Person #${values?.id ?? ""}`,
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/lib/scan-log", () => ({
  fetchScanLog: (...args: unknown[]) => mockFetchScanLog(...args),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    elevatedSurface: "#eeeeee",
    label: "#171717",
    secondaryLabel: "#5f6368",
    tertiaryLabel: "#8e8e93",
    transparent: "transparent",
  },
}));

import { ScanLogScreen } from "@/components/scan-log-screen";
import type { ScanLogEntry } from "@/lib/scan-log";
import { renderMobile } from "./render";

const entries: ScanLogEntry[] = [
  {
    activityCategory: "meal",
    activityId: 7,
    activityName: "Lunch",
    badgeId: null,
    detail: "Lunch",
    doorKind: null,
    doorLocation: null,
    id: 12,
    method: null,
    notes: "Correction",
    occurredAt: "2026-08-29T12:30:04.000Z",
    source: "activity",
    subjectName: "Ada",
    subjectSurname: "Lovelace",
    subjectUserId: 42,
  },
  {
    activityCategory: null,
    activityId: null,
    activityName: null,
    badgeId: null,
    detail: "in",
    doorKind: "in",
    doorLocation: null,
    id: 11,
    method: null,
    notes: null,
    occurredAt: "2026-08-29T12:00:00.000Z",
    source: "door",
    subjectName: "Ada",
    subjectSurname: "Lovelace",
    subjectUserId: 42,
  },
];

describe("scan history context", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchScanLog.mockResolvedValue({ items: entries, total: entries.length });
  });

  it("shows scan context and opens the relevant presence timeline", async () => {
    const user = userEvent.setup();
    await renderMobile(<ScanLogScreen />);

    expect(screen.getByText("Activity scan · Lunch · meal")).toBeTruthy();
    expect(screen.getByText("Correction")).toBeTruthy();
    expect(screen.getByText("Door scan · Entry")).toBeTruthy();

    await user.press(screen.getByRole("button", { name: /Ada Lovelace, Activity scan/ }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/others/person/[id]",
      params: { focusLogId: "12", focusSource: "activity", id: "42" },
    });
  });

  it("configures the native search bar and filters the loaded history", async () => {
    await renderMobile(<ScanLogScreen />);

    const options = mockSetOptions.mock.calls.at(-1)?.[0];
    expect(options.headerSearchBarOptions.placeholder).toBe("Search history");

    await act(async () => {
      options.headerSearchBarOptions.onChangeText({ nativeEvent: { text: "Lunch" } });
    });

    expect(screen.getByText("Activity scan · Lunch · meal")).toBeTruthy();
    expect(screen.queryByText("Door scan · Entry")).toBeNull();
  });
});
