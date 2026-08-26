import { fireEvent, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "7", manualBadge: "BADGE-1", manualNonce: "1" }),
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock("expo-router/stack", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/native-ui", () => ({
  AdaptiveBackButton: () => null,
  AdaptiveToolbarButton: () => null,
}));
jest.mock("@/components/QrCamera", () => ({ QrCamera: () => null }));
jest.mock("@/components/scanner-transaction-status", () => ({ ScannerQueueStatus: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn().mockResolvedValue({ items: [] }) }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        close: "Close",
        continue: "Continue",
        scannerActivity: "Activity",
        scannerPasses: "Passes",
        scannerPeople: "People",
        scannerRepeats: "Repeats",
        scannerStateSaved: "Saved",
        scannerStateConfirmed: "Confirmed",
        scannerStateAttention: "Attention",
        scannerRepeatFound: "Already scanned here",
        accountNotSet: "Account not set",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { id: 11 } }) }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarBottomInset: () => 0 }));
jest.mock("@/lib/scanner-db", () => ({
  enqueueLocalScan: jest.fn().mockResolvedValue("scan-1"),
  findPersonByBadge: jest.fn().mockResolvedValue({
    person: {
      userId: 21,
      email: "ada@example.com",
      role: "participant",
      ticketToken: null,
      badgeId: "BADGE-1",
      revokedBadgeIds: [],
      name: "Ada",
      surname: "Lovelace",
      accepted: true,
      confirmed: true,
      intolerances: [],
      foodIntoleranceNotes: null,
      notes: null,
      lastPresenceKind: null,
      lastPresenceAt: null,
    },
    revoked: false,
  }),
  getActivityState: jest.fn().mockResolvedValue({ count: 0 }),
  listScannerActivities: jest.fn().mockResolvedValue([
    {
      id: 7,
      name: "Workshop",
      category: "talk",
      requiresScan: true,
      startsAt: null,
      primaryLanguage: "en",
      nameI18n: {},
      descriptionI18n: {},
    },
  ]),
  pendingScans: jest.fn().mockResolvedValue([{ id: "scan-1", status: "acknowledged" }]),
}));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({
    queue: [],
    syncing: false,
    clockSkewMs: null,
    lastSync: null,
    sync: jest.fn().mockResolvedValue(undefined),
    retryFailed: jest.fn(),
    retryOne: jest.fn(),
    discardScan: jest.fn(),
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentText: "white",
    success: "green",
    warning: "orange",
    destructive: "red",
  },
}));

import { ActivityScannerScreen } from "@/components/activity-scanner-screen";
import { renderMobile } from "./render";

describe("activity scanner result (H26)", () => {
  it("offers Close after a first scan", async () => {
    await renderMobile(<ActivityScannerScreen />);

    const close = await screen.findByRole("button", { name: "Close" });
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();

    fireEvent.press(close);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close" })).toBeNull());
  });
});
