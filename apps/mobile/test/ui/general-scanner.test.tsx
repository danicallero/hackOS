import { act, screen, waitFor } from "@testing-library/react-native";

const mockMenuProps = jest.fn();
const mockSaveFilter = jest.fn();
jest.mock("@/components/filter-menu", () => ({
  FilterMenu: (props: unknown) => {
    mockMenuProps(props);
    return null;
  },
}));
const mockApiFetch = jest.fn();
let mockRefresh: () => void;
const mockCameraProps = jest.fn();
const mockPeople = [
  { userId: 1, role: "Day Staff", eventAccess: true, badgeId: "A", lastPresenceKind: "in" },
  { userId: 2, role: "Participant", eventAccess: true, badgeId: null, lastPresenceKind: null },
];

jest.mock("expo-router", () => ({
  usePathname: () => "/scan",
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
jest.mock("expo-router/stack", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/components/glass-view", () => ({
  GlassView: require("react-native").View,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/QrCamera", () => ({
  QrCamera: (props: { surfaceHeader?: (layout: unknown) => unknown }) => {
    mockCameraProps(props);
    // The stats ride in the camera surface's header, so the mock renders it.
    const { operatorLayout } = jest.requireActual("@/theme/layout-screens");
    return props.surfaceHeader?.(
      operatorLayout({ windowWidth: 390, windowHeight: 844, fontScale: 1, columnWidth: null }),
    );
  },
}));
jest.mock("@/components/scanner-transaction-status", () => ({ ScannerQueueStatus: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { id: 1 } }) }));
jest.mock("@/lib/scanner-db", () => ({ listScannerPeople: async () => mockPeople }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: (...args: unknown[]) => mockSaveFilter(...args),
}));
jest.mock("@/lib/server-events", () => ({
  startLogisticsEventStream: () => () => {},
  subscribeToServerEvent: (_event: string, callback: () => void) => {
    mockRefresh = callback;
    return () => {};
  },
}));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({ lastSync: null, serverSnapshot: { people: mockPeople }, queue: [] }),
}));

jest.mock("@/theme/colors", () => ({ colors: { accent: "blue", destructive: "red" } }));

import { GeneralScannerScreen } from "@/components/general-scanner-screen";
import { renderMobile } from "./render";

describe("scanner role counters (H8, H27)", () => {
  it("opens the general scanner with NFC first and no automatic session", async () => {
    mockApiFetch.mockResolvedValue({ byRole: [] });
    await renderMobile(<GeneralScannerScreen />);
    expect(mockCameraProps).toHaveBeenLastCalledWith(expect.objectContaining({ nfcFirst: true }));
    expect(mockCameraProps.mock.calls.at(-1)?.[0].autoStartNfc).toBeUndefined();
  });

  it("discards stale server totals after a failed refresh and uses the roster", async () => {
    mockApiFetch.mockResolvedValueOnce({
      byRole: [
        { role: "Day Staff", hasCapabilities: true, eligible: 30, accredited: 20, inside: 10 },
      ],
    });
    await renderMobile(<GeneralScannerScreen />);
    await waitFor(() => expect(screen.getByText("30")).toBeTruthy());
    mockApiFetch.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      mockRefresh();
    });
    await waitFor(() => expect(screen.queryByText("30")).toBeNull());
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByText("1")).toHaveLength(2);
  });

  it("offers actual roster roles and sums only selected role buckets", async () => {
    mockApiFetch.mockResolvedValue({
      byRole: [
        { role: "Day Staff", hasCapabilities: true, eligible: 3, accredited: 2, inside: 1 },
        { role: "Participant", hasCapabilities: false, eligible: 20, accredited: 10, inside: 5 },
        { role: "Participant", hasCapabilities: true, eligible: 1, accredited: 1, inside: 1 },
      ],
    });
    await renderMobile(<GeneralScannerScreen />);
    await waitFor(() => expect(screen.getByText("24")).toBeTruthy());
    const menu = () => mockMenuProps.mock.calls.at(-1)?.[0];
    expect(menu().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "role:Day Staff", label: "Day Staff", selected: false }),
        expect.objectContaining({ id: "role:Participant", label: "Participant", selected: false }),
        expect.objectContaining({ id: "all", selected: true }),
      ]),
    );
    await act(async () => menu().onSelect("role:Participant"));
    await waitFor(() => expect(screen.getByText("21")).toBeTruthy());
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    await act(async () => menu().onSelect("role:Day Staff"));
    await waitFor(() => expect(screen.getByText("24")).toBeTruthy());
    expect(menu().items.filter((row: { selected: boolean }) => row.selected)).toHaveLength(2);
    await act(async () => menu().onSelect("role:Participant"));
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy());
    await act(async () => menu().onSelect("all"));
    await waitFor(() => expect(screen.getByText("24")).toBeTruthy());
    expect(menu().items.find((row: { id: string }) => row.id === "all").selected).toBe(true);
    expect(mockSaveFilter).toHaveBeenLastCalledWith(expect.any(String), "[]");
  });
});
