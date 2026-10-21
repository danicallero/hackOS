import { act, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

const mockScreenOptions = jest.fn();
jest.mock("expo-router", () => ({
  usePathname: () => "/scan",
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), setParams: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
jest.mock("expo-router/stack", () => ({
  Stack: {
    Screen: (props: { options: unknown }) => {
      mockScreenOptions(props.options);
      return null;
    },
    Toolbar: Object.assign(() => null, { View: () => null }),
  },
}));
// The iOS build mounts the pane as a native stack with its own bar; jest renders the same
// contract: the pane's title and trailing items come from the host, as props of the pane.
jest.mock("@/components/pane-people-stack", () => ({
  NATIVE_PANE_STACK: true,
  PanePeopleStack: (props: {
    children: unknown;
    enabled: boolean;
    rootTitle: string;
    rootHeaderRight: unknown;
  }) => {
    const { View, Text } = require("react-native");
    return props.enabled ? (
      <View>
        <Text>{`pane-bar:${props.rootTitle}`}</Text>
        {props.rootHeaderRight}
        {props.children}
      </View>
    ) : (
      <>{props.children}</>
    );
  },
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: require("react-native").View,
  isRealLiquidGlassAvailable: () => true,
}));
jest.mock("@/components/filter-menu", () => ({
  FilterMenu: () => require("react-native").Text && null,
}));
jest.mock("@/components/QrCamera", () => ({ QrCamera: () => null }));
jest.mock("@/components/person-operations-screen", () => ({ PersonOperationsScreen: () => null }));
jest.mock("@/components/system-blur", () => ({ SystemBlur: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/scanner-transaction-status", () => ({
  ScannerQueueStatus: (props: { nativeToolbar: boolean }) => {
    const { Text } = require("react-native");
    return <Text>{`queue-status:native=${props.nativeToolbar}`}</Text>;
  },
}));
jest.mock("@/lib/api", () => ({ apiFetch: async () => ({ byRole: [] }) }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { id: 1 } }) }));
jest.mock("@/lib/scanner-db", () => ({ listScannerPeople: async () => [] }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
jest.mock("@/lib/server-events", () => ({
  startLogisticsEventStream: () => () => {},
  subscribeToServerEvent: () => () => {},
}));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({ lastSync: null, serverSnapshot: { people: [] }, queue: [] }),
}));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));

import { GeneralScannerScreen } from "@/components/general-scanner-screen";
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

afterEach(async () => {
  mockScreenOptions.mockClear();
  await act(async () => {
    Dimensions.set({ window: initialWindow, screen: initialScreen });
  });
});

describe("scanner native pane stack (H22, H55)", () => {
  it("hides the route header in two panes so no native bar covers the pane chrome", async () => {
    await setWindow(1180, 820);
    await renderMobile(<GeneralScannerScreen />);

    expect(mockScreenOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerShown: false }),
    );
    // The pane's own bar owns the title and the sync status; the route's toolbar does not.
    expect(screen.getByText("pane-bar:tabScan")).toBeTruthy();
    expect(screen.getByText("queue-status:native=false")).toBeTruthy();
  });

  it("keeps the route header in a compact window", async () => {
    await setWindow(390, 844);
    await renderMobile(<GeneralScannerScreen />);

    expect(mockScreenOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerShown: true }),
    );
    expect(screen.queryByText("pane-bar:tabScan")).toBeNull();
  });
});
