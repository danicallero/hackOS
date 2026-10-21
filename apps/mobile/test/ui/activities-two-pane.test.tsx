import { act, fireEvent, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

const mockPush = jest.fn();
const mockListActivities = jest.fn();

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: mockPush }),
  useScrollToTop: () => {},
}));
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children }: { children: unknown }) => {
    const ReactLib = require("react");
    return ReactLib.createElement(ReactLib.Fragment, null, children);
  },
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy(
    {},
    { get: (_target, key) => (key === "transparent" ? "transparent" : "#808080") },
  ),
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
// The embedded scanner is covered by activity-scanner.test; here it only proves which activity
// the pane holds and that it is the same instance across a resize.
let mockScannerMounts = 0;
jest.mock("@/components/activity-scanner-screen", () => {
  const ReactLib = require("react");
  const { Text } = require("react-native");
  return {
    ActivityScannerScreen: ({
      activityId,
      embedded,
    }: {
      activityId: number;
      embedded: boolean;
    }) => {
      ReactLib.useEffect(() => {
        mockScannerMounts += 1;
      }, []);
      return ReactLib.createElement(Text, { testID: "scanner-pane" }, `${activityId}:${embedded}`);
    },
  };
});

import { ActivitiesScreen } from "@/components/activities-screen";
import type { ScannerActivity } from "@/lib/scanner-types";
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
  mockPush.mockClear();
  mockScannerMounts = 0;
  mockListActivities.mockResolvedValue(ACTIVITIES);
  setWindow(1180, 820);
});
afterEach(() => setWindow(390, 844));

describe("activities list and scanner pane (H22, H55)", () => {
  it("shows the list with an empty scanner pane in a wide window", async () => {
    await renderMobile(<ActivitiesScreen />);
    expect(await screen.findByText("Charla Grafana")).toBeTruthy();
    expect(screen.queryByTestId("scanner-pane")).toBeNull();
    expect(screen.getByLabelText(/No activity selected/)).toBeTruthy();
    await fireEvent.press(screen.getByText("Charla Grafana"));
    expect(screen.queryByLabelText(/No activity selected/)).toBeNull();
  });

  it("opens the selected activity's scanner beside the list without navigating", async () => {
    await renderMobile(<ActivitiesScreen />);
    await fireEvent.press(await screen.findByText("Charla Grafana"));
    expect(screen.getByTestId("scanner-pane").props.children).toBe("2:true");
    expect(mockPush).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Cena Sábado"));
    expect(screen.getByTestId("scanner-pane").props.children).toBe("1:true");
    expect(screen.getByRole("button", { name: /Cena Sábado/, selected: true })).toBeTruthy();
  });

  it("selects the activity a route names", async () => {
    await renderMobile(<ActivitiesScreen deepLink={{ id: 2, nonce: "a" }} />);
    expect(await screen.findByTestId("scanner-pane")).toHaveTextContent?.("2:true");
    expect(screen.getByTestId("scanner-pane").props.children).toBe("2:true");
  });

  it("pushes the scanner route in a compact window", async () => {
    setWindow(390, 844);
    await renderMobile(<ActivitiesScreen />);
    await fireEvent.press(await screen.findByText("Charla Grafana"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/activities/[id]", params: { id: "2" } });
    expect(screen.queryByTestId("scanner-pane")).toBeNull();
  });

  it("keeps the selection and the scanner instance across a resize, and across compact", async () => {
    await renderMobile(<ActivitiesScreen />);
    await fireEvent.press(await screen.findByText("Charla Grafana"));
    await act(async () => setWindow(1366, 1032));
    expect(screen.getByTestId("scanner-pane").props.children).toBe("2:true");
    expect(mockScannerMounts).toBe(1);
    await act(async () => setWindow(390, 844));
    expect(screen.queryByTestId("scanner-pane")).toBeNull();
    await act(async () => setWindow(1180, 820));
    expect(screen.getByTestId("scanner-pane").props.children).toBe("2:true");
  });
});
