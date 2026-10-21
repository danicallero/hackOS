import { act, fireEvent, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: Record<string, string | undefined> = {};
const mockPeople = [
  { userId: 7, role: "Participant", eventAccess: true, badgeId: "BADGE-7", ticketToken: "T-7" },
  { userId: 8, role: "Participant", eventAccess: true, badgeId: "BADGE-8", ticketToken: "T-8" },
];

jest.mock("expo-router", () => ({
  usePathname: () => "/scan",
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
jest.mock("expo-router/stack", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/components/glass-view", () => ({
  GlassView: require("react-native").View,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/system-blur", () => ({ SystemBlur: () => null }));
jest.mock("@/components/filter-menu", () => ({ FilterMenu: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/scanner-transaction-status", () => ({ ScannerQueueStatus: () => null }));

let mockMounts = 0;
let mockUnmounts = 0;
jest.mock("@/components/QrCamera", () => ({
  QrCamera: (props: { onValue: (value: string) => void; onOpenPeople?: () => void }) => {
    const React = require("react");
    const { Text: RNText } = require("react-native");
    React.useEffect(() => {
      mockMounts += 1;
      return () => {
        mockUnmounts += 1;
      };
    }, []);
    return (
      <>
        <RNText onPress={() => props.onValue("T-7")}>scan-seven</RNText>
        <RNText onPress={props.onOpenPeople}>view-people</RNText>
      </>
    );
  },
}));
jest.mock("@/components/people-directory-screen", () => ({
  PeopleDirectoryScreen: (props: {
    embedded?: boolean;
    onClose?: () => void;
    onSelect?: (person: { userId: number }) => void;
  }) => {
    const { Text: RNText } = require("react-native");
    return (
      <>
        <RNText>{props.embedded ? "finder-overlay" : "finder-route"}</RNText>
        <RNText onPress={() => props.onSelect?.({ userId: 8 })}>pick-eight</RNText>
        <RNText onPress={props.onClose}>close-finder</RNText>
      </>
    );
  },
}));
jest.mock("@/components/person-operations-screen", () => ({
  PersonOperationsScreen: (props: { userId?: number; embedded?: boolean }) => {
    const { Text: RNText } = require("react-native");
    return <RNText>{`profile-${props.userId}-${props.embedded ? "pane" : "route"}`}</RNText>;
  },
}));
jest.mock("@/lib/api", () => ({ apiFetch: async () => ({ byRole: [] }) }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { id: 1 } }) }));
jest.mock("@/lib/scanner-db", () => ({
  listScannerPeople: async () => mockPeople,
  findPersonByTicket: async () => null,
  findPersonByBadge: async () => null,
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
jest.mock("@/lib/server-events", () => ({
  startLogisticsEventStream: () => () => {},
  subscribeToServerEvent: () => () => {},
}));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({ lastSync: null, serverSnapshot: { people: mockPeople }, queue: [] }),
}));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));

import { GeneralScannerScreen } from "@/components/general-scanner-screen";
import { emitTabReselect } from "@/lib/tab-reselect";
import { renderMobile } from "./render";

const initialWindow = Dimensions.get("window");
const initialScreen = Dimensions.get("screen");

async function setWindow(width: number, height: number) {
  await act(async () => {
    Dimensions.set({
      window: { ...initialWindow, width, height },
      screen: { ...initialScreen, width, height },
    });
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockSetParams.mockClear();
  mockParams = {};
  mockMounts = 0;
  mockUnmounts = 0;
});
afterEach(async () => {
  await act(async () => {
    Dimensions.set({ window: initialWindow, screen: initialScreen });
  });
});

describe("scanner two panes (H22, H55)", () => {
  it("opens a scanned person in the right pane without navigating", async () => {
    await setWindow(1180, 820);
    await renderMobile(<GeneralScannerScreen />);
    expect(screen.queryByText(/^profile-/)).toBeNull();

    await fireEvent.press(screen.getByText("scan-seven"));

    expect(await screen.findByText("profile-7-pane")).toBeTruthy();
    expect(screen.getByText("scan-seven")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a placeholder in the right pane until the first scan replaces it", async () => {
    await setWindow(1180, 820);
    await renderMobile(<GeneralScannerScreen />);
    expect(screen.getByText("panePlaceholderScanTitle")).toBeTruthy();

    await fireEvent.press(screen.getByText("scan-seven"));
    expect(await screen.findByText("profile-7-pane")).toBeTruthy();
    expect(screen.queryByText("panePlaceholderScanTitle")).toBeNull();
  });

  it("returns to the start when the selected Scanner tab is pressed again", async () => {
    await setWindow(1180, 820);
    mockParams = {};
    await renderMobile(<GeneralScannerScreen />);
    await fireEvent.press(screen.getByText("scan-seven"));
    await fireEvent.press(screen.getByText("view-people"));
    expect(await screen.findByText("profile-7-pane")).toBeTruthy();

    await act(async () => emitTabReselect("scan"));

    expect(screen.queryByText("profile-7-pane")).toBeNull();
    expect(screen.getByText("panePlaceholderScanTitle")).toBeTruthy();
    expect(screen.queryByText("finder-overlay")).toBeNull();
    expect(mockSetParams).toHaveBeenCalledWith({
      personId: undefined,
      focusLogId: undefined,
      focusSource: undefined,
    });
  });

  it("pushes the person route in a compact window", async () => {
    await setWindow(390, 844);
    await renderMobile(<GeneralScannerScreen />);

    await fireEvent.press(screen.getByText("scan-seven"));

    await act(async () => {});
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/scan/person/[id]",
      params: { id: "7" },
    });
    expect(screen.queryByText(/^profile-/)).toBeNull();
  });

  it("keeps the selection and the reader mounted across a resize", async () => {
    await setWindow(1180, 820);
    await renderMobile(<GeneralScannerScreen />);
    await fireEvent.press(screen.getByText("scan-seven"));
    expect(await screen.findByText("profile-7-pane")).toBeTruthy();

    await setWindow(390, 844);
    expect(screen.queryByText("profile-7-pane")).toBeNull();
    await setWindow(1180, 820);

    expect(await screen.findByText("profile-7-pane")).toBeTruthy();
    expect(mockMounts).toBe(1);
    expect(mockUnmounts).toBe(0);
  });

  it("selects the person a deep link hands over and clears the params", async () => {
    await setWindow(1180, 820);
    mockParams = { personId: "8", focusLogId: "3", focusSource: "door" };
    await renderMobile(<GeneralScannerScreen />);

    expect(await screen.findByText("profile-8-pane")).toBeTruthy();
    expect(mockSetParams).toHaveBeenCalledWith({
      personId: undefined,
      focusLogId: undefined,
      focusSource: undefined,
    });
  });

  it("opens the people finder over the reader and selects the pick on the right", async () => {
    await setWindow(1180, 820);
    await renderMobile(<GeneralScannerScreen />);
    await fireEvent.press(screen.getByText("scan-seven"));
    expect(await screen.findByText("profile-7-pane")).toBeTruthy();

    await fireEvent.press(screen.getByText("view-people"));
    expect(await screen.findByText("finder-overlay")).toBeTruthy();
    expect(screen.getByText("profile-7-pane")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("pick-eight"));
    expect(await screen.findByText("profile-8-pane")).toBeTruthy();
    expect(screen.queryByText("finder-overlay")).toBeNull();
    expect(mockUnmounts).toBe(0);
  });

  it("closes the finder without touching the selected profile", async () => {
    await setWindow(1180, 820);
    await renderMobile(<GeneralScannerScreen />);
    await fireEvent.press(screen.getByText("scan-seven"));
    await fireEvent.press(screen.getByText("view-people"));
    await fireEvent.press(await screen.findByText("close-finder"));

    expect(screen.queryByText("finder-overlay")).toBeNull();
    expect(screen.getByText("profile-7-pane")).toBeTruthy();
  });

  it("restores the whole scanner pane after the finder is opened and closed (no blank pane)", async () => {
    await setWindow(1180, 820);
    await renderMobile(<GeneralScannerScreen />);
    await fireEvent.press(screen.getByText("scan-seven"));
    for (let round = 0; round < 2; round += 1) {
      await fireEvent.press(screen.getByText("view-people"));
      await fireEvent.press(await screen.findByText("close-finder"));
      // The reader, its actions and the selected profile are all still on screen.
      expect(screen.getByText("scan-seven")).toBeTruthy();
      expect(screen.getByText("view-people")).toBeTruthy();
      expect(screen.getByText("profile-7-pane")).toBeTruthy();
    }
    expect(mockMounts).toBe(1);
    expect(mockUnmounts).toBe(0);
  });

  it("navigates to the people route in a compact window", async () => {
    await setWindow(390, 844);
    await renderMobile(<GeneralScannerScreen />);
    await fireEvent.press(screen.getByText("view-people"));

    expect(mockPush).toHaveBeenCalledWith("/(tabs)/scan/people");
    expect(screen.queryByText("finder-overlay")).toBeNull();
  });
});
