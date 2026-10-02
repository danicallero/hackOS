import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, Platform } from "react-native";
import { PersonOperationsScreen } from "@/components/person-operations-screen";
import { submitScannerMutation } from "@/lib/scanner-sync";
import { renderMobile } from "./render";

let mockMenuProps: { onPressAction: (event: { nativeEvent: { event: string } }) => void };
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: (props: typeof mockMenuProps & { children: unknown }) => {
    mockMenuProps = props;
    return props.children;
  },
}));
let mockNfcVisible = false;
const mockTranslate = (key: string) => key;
const mockPerson = {
  userId: 21,
  name: "Badge",
  surname: "Tester",
  email: "badge@example.test",
  role: "participant",
  eventAccess: true,
  confirmed: true,
  accepted: true,
  hasCapabilities: false,
  isEnterpriseJudge: false,
  ticketToken: "TICKET-21",
  badgeId: null as string | null,
  revokedBadgeIds: [],
  dni: null,
  intolerances: [],
  foodIntoleranceNotes: null,
  notes: null,
  lastPresenceKind: null,
  lastPresenceAt: null,
};
const mockSyncState = {
  serverSnapshot: { people: [mockPerson] },
  lastSync: null,
  sync: jest.fn().mockResolvedValue(undefined),
};
const mockNavigation = { setOptions: jest.fn() };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "21" }),
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/scan/person/21",
  useNavigation: () => mockNavigation,
  useScrollToTop: () => {},
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));
jest.mock("expo-router/stack", () => ({ __esModule: true, default: {}, Stack: {} }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: mockTranslate }) }));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 11, capabilities: ["*"] } }),
}));
jest.mock("@/lib/use-scanner", () => ({ useScannerSync: () => mockSyncState }));
jest.mock("@/lib/scanner-sync", () => ({
  submitScannerMutation: jest.fn().mockResolvedValue({ state: "acknowledged" }),
}));
jest.mock("@/lib/scanner-db", () => ({
  findPersonById: jest.fn(),
  enqueueLocalScan: jest.fn(),
  pendingScans: jest.fn(),
}));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn().mockRejectedValue(new Error("Offline")),
  ApiError: class ApiError extends Error {},
}));
jest.mock("@/lib/use-presence-summary", () => ({
  usePresenceSummary: () => ({ timeline: null, guaranteedMinutes: 0 }),
}));
jest.mock("@/components/presence-management", () => ({
  PresenceManagement: () => null,
  formatMinutes: () => "0 min",
}));
jest.mock("@/components/nfc-reader", () => ({
  NfcReader: ({ visible }: { visible: boolean }) => {
    mockNfcVisible = visible;
    return null;
  },
}));
jest.mock("@/components/QrCamera", () => ({
  QrCamera: ({ onValue }: { onValue: (code: string) => void }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan fixture code"
        onPress={() => onValue("QR-NEW")}
      >
        <Text>Scan fixture code</Text>
      </Pressable>
    );
  },
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/router-tabs-inset", () => ({
  useRouterTabBarBottomInset: () => 0,
  useRouterTabBarScrollBottomInset: () => 0,
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    background: "white",
    surface: "white",
    label: "black",
    accent: "blue",
    separator: "gray",
    primaryAction: "blue",
    primaryActionText: "white",
  },
}));

const originalOS = Platform.OS;
beforeEach(() => {
  Platform.OS = "android";
  mockPerson.badgeId = null;
  mockNfcVisible = false;
  jest.mocked(submitScannerMutation).mockClear();
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

it("links a manually entered code through the existing accreditation mutation", async () => {
  await renderMobile(<PersonOperationsScreen />);
  await screen.findByRole("button", { name: "personLinkBadgeNfc" });
  await act(() => mockMenuProps.onPressAction({ nativeEvent: { event: "manual" } }));
  await fireEvent.changeText(screen.getByLabelText("scannerManualEntryTitle"), "  MANUAL-NEW  ");
  await fireEvent.press(screen.getByRole("button", { name: "personLinkBadge" }));
  await waitFor(() =>
    expect(submitScannerMutation).toHaveBeenCalledWith(
      {
        kind: "accreditation_user",
        userId: 21,
        badgeId: "MANUAL-NEW",
        method: "manual",
        attendeeRole: undefined,
      },
      11,
    ),
  );
  expect(submitScannerMutation).toHaveBeenCalledTimes(1);
});

it("offers QR as a secondary replacement method and retains the badge being revoked", async () => {
  mockPerson.badgeId = "OLD-BADGE";
  const alert = jest.spyOn(Alert, "alert");
  await renderMobile(<PersonOperationsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "personReplaceBadge" }));
  expect(alert).toHaveBeenCalledWith(
    "personReplaceBadge",
    "personReplaceBadgeMethod",
    expect.any(Array),
    { cancelable: true },
  );
  const methods = alert.mock.calls[0][2];
  expect(methods?.map((method) => method.text)).toEqual([
    "personScanBadgeCode",
    "scannerNfcScan",
    "cancel",
  ]);
  expect(methods?.find((method) => method.text === "scannerNfcScan")?.isPreferred).toBe(true);
  await act(() => methods?.find((method) => method.text === "personScanBadgeCode")?.onPress?.());
  expect(submitScannerMutation).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Scan fixture code" }));
  await waitFor(() =>
    expect(submitScannerMutation).toHaveBeenCalledWith(
      {
        kind: "badge_rotation",
        userId: 21,
        currentBadgeId: "OLD-BADGE",
        newBadgeId: "QR-NEW",
        reason: "badgeReplacementReason",
      },
      11,
    ),
  );
});

it("starts NFC on the first press when linking an existing attendee", async () => {
  const alert = jest.spyOn(Alert, "alert");
  await renderMobile(<PersonOperationsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "personLinkBadgeNfc" }));
  expect(mockNfcVisible).toBe(true);
  expect(alert).not.toHaveBeenCalled();
});
