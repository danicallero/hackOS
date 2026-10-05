jest.mock("@/lib/use-nfc-supported", () => ({ useNfcSupported: () => true }));

import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, Platform } from "react-native";
import { PersonOperationsScreen } from "@/components/person-operations-screen";
import { apiFetch } from "@/lib/api";
import { enqueueLocalScan, pendingScans } from "@/lib/scanner-db";
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
let mockQrCameraMountCount = 0;
jest.mock("@/components/badge-replacement-dialog", () => ({
  BadgeReplacementDialog: ({
    visible,
    onSelect,
    onClose,
  }: {
    visible: boolean;
    onSelect: (method: "qr" | "nfc") => void;
    onClose: () => void;
  }) => {
    if (!visible) return null;
    const { Pressable, Text, View } = require("react-native");
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="personScanBadgeCode"
          onPress={() => onSelect("qr")}
        >
          <Text>QR</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="scannerNfcScan"
          onPress={() => onSelect("nfc")}
        >
          <Text>NFC</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="cancel" onPress={onClose}>
          <Text>Cancel</Text>
        </Pressable>
      </View>
    );
  },
}));
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
  lastPresenceKind: null as "in" | "out" | null,
  lastPresenceAt: null as string | null,
};
const mockSyncState = {
  serverSnapshot: { people: [mockPerson] },
  lastSync: null,
  sync: jest.fn().mockResolvedValue(undefined),
};
const mockRouter = { push: jest.fn() };
const mockNavigation = { setOptions: jest.fn() };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "21" }),
  useRouter: () => mockRouter,
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
  usePresenceSummary: () => ({
    timeline: null,
    guaranteedMinutes: 0,
    refresh: jest.fn().mockResolvedValue(undefined),
  }),
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
    mockQrCameraMountCount += 1;
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
  mockPerson.lastPresenceKind = null;
  mockPerson.lastPresenceAt = null;
  jest.mocked(apiFetch).mockReset().mockRejectedValue(new Error("Offline"));
  mockSyncState.sync.mockReset().mockResolvedValue(undefined);
  mockNfcVisible = false;
  mockQrCameraMountCount = 0;
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

it("mounts the QR camera only after the operator chooses QR", async () => {
  await renderMobile(<PersonOperationsScreen />);
  expect(mockQrCameraMountCount).toBe(0);

  await act(() => mockMenuProps.onPressAction({ nativeEvent: { event: "qr" } }));
  expect(mockQrCameraMountCount).toBe(1);
});

it("offers QR in the native iOS replacement dialog and retains the badge being revoked", async () => {
  Platform.OS = "ios";
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

it("opens the Android Material dialog and starts the selected NFC reader", async () => {
  mockPerson.badgeId = "OLD-BADGE";
  const alert = jest.spyOn(Alert, "alert");
  await renderMobile(<PersonOperationsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "personReplaceBadge" }));
  expect(alert).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "personEnterBadgeCode" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "scannerNfcScan" }));
  expect(mockNfcVisible).toBe(true);
  expect(screen.queryByRole("button", { name: "personScanBadgeCode" })).toBeNull();
});

it("dismisses Android replacement without changing the badge", async () => {
  mockPerson.badgeId = "OLD-BADGE";
  await renderMobile(<PersonOperationsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "personReplaceBadge" }));
  await fireEvent.press(screen.getByRole("button", { name: "cancel" }));
  expect(mockNfcVisible).toBe(false);
  expect(submitScannerMutation).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "personScanBadgeCode" })).toBeNull();
});

it("treats the server's null badge as authoritative over the cached badge", async () => {
  mockPerson.badgeId = "OLD-BADGE";
  jest.mocked(apiFetch).mockResolvedValue({ currentBadge: null });
  await renderMobile(<PersonOperationsScreen />);
  await screen.findByRole("button", { name: "personLinkBadgeNfc" });
  expect(screen.queryByRole("button", { name: "personReplaceBadge" })).toBeNull();
});

it("removes the badge controls immediately after an acknowledged removal", async () => {
  mockPerson.badgeId = "OLD-BADGE";
  const alert = jest.spyOn(Alert, "alert");
  await renderMobile(<PersonOperationsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "personDeleteBadge" }));
  await act(async () => {
    alert.mock.calls[0][2]?.find((button) => button.text === "delete")?.onPress?.();
  });
  await screen.findByRole("button", { name: "personLinkBadgeNfc" });
  expect(screen.queryByRole("button", { name: "personDeleteBadge" })).toBeNull();
  expect(submitScannerMutation).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "badge_removal" }),
    11,
  );
});

it("switches the primary movement using the fresh sync snapshot", async () => {
  mockPerson.badgeId = "BADGE";
  const freshPerson = {
    ...mockPerson,
    lastPresenceKind: "in",
    lastPresenceAt: new Date().toISOString(),
  };
  mockSyncState.sync.mockResolvedValue({ people: [freshPerson] });
  jest.mocked(enqueueLocalScan).mockResolvedValue("presence-1");
  jest
    .mocked(pendingScans)
    .mockResolvedValue([{ id: "presence-1", status: "acknowledged" }] as never);
  await renderMobile(<PersonOperationsScreen />);
  const entry = await screen.findByRole("button", { name: "personRegisterEntry" });
  expect(screen.getByRole("button", { name: "personRegisterExit" })).toBeTruthy();
  await fireEvent.press(entry);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "personRegisterExit" })).not.toBeDisabled(),
  );
  jest.mocked(enqueueLocalScan).mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "personRegisterExit" }));
  await waitFor(() =>
    expect(enqueueLocalScan).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "presence", direction: "out" }),
      11,
    ),
  );
  expect(screen.getByRole("button", { name: "personRegisterEntry" })).toBeTruthy();
});

it("switches exit to entry using the acknowledged snapshot", async () => {
  mockPerson.badgeId = "BADGE";
  mockPerson.lastPresenceKind = "in";
  mockPerson.lastPresenceAt = "2026-10-03T10:00:00Z";
  mockSyncState.sync.mockResolvedValue({
    people: [{ ...mockPerson, lastPresenceKind: "out", lastPresenceAt: new Date().toISOString() }],
  });
  jest.mocked(enqueueLocalScan).mockResolvedValue("presence-2");
  jest
    .mocked(pendingScans)
    .mockResolvedValue([{ id: "presence-2", status: "acknowledged" }] as never);
  await renderMobile(<PersonOperationsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "personRegisterExit" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "personRegisterEntry" })).not.toBeDisabled(),
  );
  jest.mocked(enqueueLocalScan).mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "personRegisterEntry" }));
  await waitFor(() =>
    expect(enqueueLocalScan).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "presence", direction: "in" }),
      11,
    ),
  );
  expect(screen.getByRole("button", { name: "personRegisterExit" })).toBeTruthy();
});

it("keeps the badge visible and surfaces a rejected removal", async () => {
  mockPerson.badgeId = "OLD-BADGE";
  jest.mocked(submitScannerMutation).mockRejectedValueOnce(new Error("Removal rejected"));
  const alert = jest.spyOn(Alert, "alert");
  await renderMobile(<PersonOperationsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "personDeleteBadge" }));
  await act(async () => {
    alert.mock.calls[0][2]?.find((button) => button.text === "delete")?.onPress?.();
  });
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith("scannerBusinessRejected", "Removal rejected"),
  );
  expect(screen.getByRole("button", { name: "personDeleteBadge" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "personLinkBadgeNfc" })).toBeNull();
});

it("preserves the secondary movement's date and time editor", async () => {
  mockPerson.badgeId = "BADGE";
  mockRouter.push.mockClear();
  await renderMobile(<PersonOperationsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "personRegisterExit" }));
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: "/scan/person/presence/[id]",
    params: { id: "21", draftKind: "out", draftAt: expect.any(String) },
  });
});
