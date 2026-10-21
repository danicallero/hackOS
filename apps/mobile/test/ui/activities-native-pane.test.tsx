import { act, fireEvent, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

const mockSetOptions = jest.fn();
const mockSetParams = jest.fn();
const mockListActivities = jest.fn();
let mockPaneProps: { enabled: boolean; rootOptions: Record<string, unknown> } | null = null;

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useRouter: () => ({ push: jest.fn(), setParams: mockSetParams }),
  useScrollToTop: () => {},
}));
jest.mock("expo-router/stack", () => ({
  __esModule: true,
  default: { Toolbar: Object.assign(() => null, { View: () => null }) },
}));
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => true,
}));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy(
    {},
    { get: (_target, key) => (key === "transparent" ? "transparent" : "#808080") },
  ),
}));
// The iOS build mounts each pane as a native stack; jest renders its contract: the host's props.
jest.mock("@/components/pane-native-stack", () => ({
  NATIVE_PANE_STACK: true,
  PaneNativeStack: (props: {
    enabled: boolean;
    rootOptions: Record<string, unknown>;
    children: unknown;
  }) => {
    mockPaneProps = props;
    return props.children;
  },
}));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/lib/fold-region", () => ({ useBookCrease: () => null }));
jest.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, apiFetch: jest.fn() }));
jest.mock("@/lib/scanner-db", () => ({ listScannerActivities: () => mockListActivities() }));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({
    autoRetryPaused: false,
    error: null,
    lastSync: null,
    serverSnapshot: null,
    sync: jest.fn().mockResolvedValue(undefined),
    syncing: false,
  }),
  isSyncConflict: () => false,
}));
jest.mock("@/components/activity-scanner-screen", () => {
  const { Text } = require("react-native");
  return {
    ActivityScannerScreen: ({ activityId }: { activityId: number }) => (
      <Text testID="scanner-pane">{String(activityId)}</Text>
    ),
  };
});

import { ActivitiesScreen } from "@/components/activities-screen";
import type { ScannerActivity } from "@/lib/scanner-types";
import { emitTabReselect } from "@/lib/tab-reselect";
import { renderMobile } from "./render";

const base = { primaryLanguage: "es", nameI18n: {}, descriptionI18n: {}, startsAt: null } as const;
const ACTIVITIES: ScannerActivity[] = [
  { id: 1, name: "Cena Sábado", category: "meal", requiresScan: true, ...base },
  { id: 2, name: "Charla Grafana", category: "talk", requiresScan: true, ...base },
];

function setWindow(width: number, height: number) {
  const metrics = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: metrics, screen: metrics });
}

beforeEach(() => {
  mockSetOptions.mockClear();
  mockSetParams.mockClear();
  mockPaneProps = null;
  mockListActivities.mockResolvedValue(ACTIVITIES);
  setWindow(1180, 820);
});
afterEach(() => setWindow(390, 844));

describe("activities list pane as a native stack (H22, H55)", () => {
  it("hides the route header so no native bar covers the panes", async () => {
    await renderMobile(<ActivitiesScreen />);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ headerShown: false });
  });

  it("keeps the route header in a compact window", async () => {
    setWindow(390, 844);
    await renderMobile(<ActivitiesScreen />);
    expect(mockSetOptions).toHaveBeenLastCalledWith(expect.objectContaining({ headerShown: true }));
    expect(mockPaneProps?.enabled).toBeFalsy();
  });

  it("draws the shared title and the filter as separate native bar items", async () => {
    await renderMobile(<ActivitiesScreen />);
    expect(mockPaneProps?.enabled).toBe(true);
    const options = mockPaneProps?.rootOptions as {
      headerTransparent: boolean;
      title: string;
      unstable_headerLeftItems: () => Array<{ type: string; hidesSharedBackground: boolean }>;
      unstable_headerRightItems: () => Array<{
        type: string;
        menu?: { items: Array<{ label: string; state: string; onPress: () => void }> };
      }>;
      headerSearchBarOptions: { placement: string };
    };
    expect(options.headerTransparent).toBe(false);
    expect(options.unstable_headerLeftItems()).toEqual([
      expect.objectContaining({ type: "custom", hidesSharedBackground: true }),
    ]);
    const right = options.unstable_headerRightItems();
    // Only real native items (no custom view), so each draws and presses as a system bar button.
    expect(right.map((item) => item.type)).toEqual(["menu"]);
    expect(right[0]).not.toHaveProperty("hidesSharedBackground");
    // The native menu selects a kind and the list filters.
    expect(await screen.findByText("Cena Sábado")).toBeTruthy();
    const talk = right[0]?.menu?.items.find((item) => item.state === "off");
    await act(async () => talk?.onPress());
    expect(options.headerSearchBarOptions.placement).toBe("integratedButton");
  });

  it("returns the right pane to the placeholder when the selected tab is pressed again", async () => {
    await renderMobile(<ActivitiesScreen deepLink={{ id: 2, nonce: "a" }} />);
    expect(await screen.findByTestId("scanner-pane")).toBeTruthy();
    await act(async () => emitTabReselect("activities"));
    expect(screen.queryByTestId("scanner-pane")).toBeNull();
    expect(screen.getByLabelText(/No activity selected/)).toBeTruthy();
    expect(mockSetParams).toHaveBeenCalledWith({ selected: undefined, selectedNonce: undefined });
  });

  it("keeps the selection across a resize", async () => {
    await renderMobile(<ActivitiesScreen />);
    await fireEvent.press(await screen.findByText("Charla Grafana"));
    await act(async () => setWindow(1366, 1032));
    expect(screen.getByTestId("scanner-pane").props.children).toBe("2");
  });
});
