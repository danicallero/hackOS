import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

let mockPane: {
  enabled: boolean;
  rootOptions: Record<string, unknown>;
  pushed: {
    open: boolean;
    onClose: () => void;
    options?: unknown;
    render: () => unknown;
  };
} | null = null;
let mockStatusProps: { open?: boolean; triggerless?: boolean } = {};
let mockSyncing = false;

jest.mock("@/components/scanner-action-button", () =>
  jest.requireActual("@/components/scanner-action-button.tsx"),
);
jest.mock("@/lib/server-events", () => ({
  startLogisticsEventStream: () => () => {},
  subscribeToServerEvent: () => () => {},
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useIsFocused: () => true,
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("expo-router/stack", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => true,
}));
jest.mock("@/components/native-ui", () => ({
  AdaptiveBackButton: () => null,
  AdaptiveToolbarButton: () => null,
}));
jest.mock("@/components/QrCamera", () => ({ QrCamera: () => null }));
jest.mock("@/components/scanner-code-entry", () => ({ ScannerCodeEntry: () => null }));
jest.mock("@/components/nfc-reader", () => ({ NfcReader: () => null }));
jest.mock("@/lib/use-nfc-supported", () => ({ useNfcSupportStatus: () => "unsupported" }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn().mockResolvedValue({ items: [] }) }));
jest.mock("@/lib/live-activities/sync", () => ({ bumpActivityScanned: jest.fn() }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        scannerStateReady: "Ready",
        scannerStateAttention: "Attention",
        tabActivities: "Activities",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { id: 11 } }) }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarBottomInset: () => 0 }));
jest.mock("@/components/pane-native-stack", () => ({
  NATIVE_PANE_STACK: true,
  PaneNativeStack: (props: NonNullable<typeof mockPane> & { children: unknown }) => {
    mockPane = props;
    return props.children;
  },
}));
// The RN panel is the Android/jest fallback only; on iOS it must never mount.
jest.mock("@/components/people-finder-pane", () => ({
  PeopleFinderPane: () =>
    require("react-native").Text &&
    require("react").createElement(require("react-native").Text, null, "rn-finder"),
}));
jest.mock("@/components/people-directory-screen", () => ({
  PeopleDirectoryScreen: () => null,
}));
jest.mock("@/components/scanner-transaction-status", () => ({
  ScannerQueueStatus: (props: { open?: boolean; triggerless?: boolean }) => {
    mockStatusProps = props;
    return null;
  },
}));
jest.mock("@/lib/scanner-db", () => ({
  enqueueLocalScan: jest.fn().mockResolvedValue("scan-1"),
  findPersonByTicket: jest.fn().mockResolvedValue(null),
  findPersonByBadge: jest.fn().mockResolvedValue({
    person: {
      userId: 21,
      email: "ada@example.com",
      role: "participant",
      badgeId: "BADGE-1",
      revokedBadgeIds: [],
      name: "Ada",
      surname: "Lovelace",
    },
    revoked: false,
  }),
  getActivityState: jest.fn().mockResolvedValue({ count: 0 }),
  listScannerPeople: jest.fn().mockResolvedValue([]),
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
  pendingScans: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({
    queue: [],
    syncing: mockSyncing,
    clockSkewMs: null,
    lastSync: null,
    refreshLocal: jest.fn().mockResolvedValue(undefined),
    sync: jest.fn().mockResolvedValue(undefined),
    retryFailed: jest.fn(),
    retryOne: jest.fn(),
    discardScan: jest.fn(),
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));

import { ActivityScannerScreen } from "@/components/activity-scanner-screen";
import { enqueueLocalScan } from "@/lib/scanner-db";
import { renderMobile } from "./render";

type BarItem = {
  type: string;
  hidesSharedBackground?: boolean;
  selected?: boolean;
  label?: string;
  onPress?: () => void;
};

beforeEach(() => {
  mockPane = null;
  mockSyncing = false;
  mockStatusProps = {};
});

describe("embedded activity scanner as a native stack (H22, H26, H55)", () => {
  it("shows the Ready status as a native button item that opens the queue sheet", async () => {
    await renderMobile(<ActivityScannerScreen embedded activityId={7} />);
    expect(mockPane?.enabled).toBe(true);
    const options = mockPane?.rootOptions as {
      unstable_headerLeftItems: () => BarItem[];
      unstable_headerRightItems: () => BarItem[];
    };
    expect(options.unstable_headerLeftItems()).toEqual([
      expect.objectContaining({ type: "custom", hidesSharedBackground: true }),
    ]);
    const [status] = options.unstable_headerRightItems();
    expect(status).toEqual(
      expect.objectContaining({
        type: "button",
        label: "Ready",
        selected: false,
      }),
    );
    // Actions keep their glass; only the title item hides its shared background.
    expect(status).not.toHaveProperty("hidesSharedBackground");
    // The sheet is hosted without a trigger of its own: the bar item is the only control.
    expect(mockStatusProps.triggerless).toBe(true);
    expect(mockStatusProps.open).toBe(false);
    await act(async () => status?.onPress?.());
    expect(mockStatusProps.open).toBe(true);
  });

  it("marks the status item busy while a sync runs", async () => {
    mockSyncing = true;
    await renderMobile(<ActivityScannerScreen embedded activityId={7} />);
    const options = mockPane?.rootOptions as { unstable_headerRightItems: () => BarItem[] };
    expect(options.unstable_headerRightItems()[0]?.selected).toBe(true);
  });

  it("pushes the Scanner's finder natively, badge holders only, and scans the pick", async () => {
    await renderMobile(<ActivityScannerScreen embedded activityId={7} />);
    expect(mockPane?.pushed.open).toBe(false);
    await fireEvent.press(await screen.findByRole("button", { name: "scannerViewPeople" }));
    expect(mockPane?.pushed.open).toBe(true);
    expect(screen.queryByText("rn-finder")).toBeNull();
    // The back item is an icon-only circle, without the "Activities" text.
    expect(mockPane?.pushed.options).toEqual({ headerBackButtonDisplayMode: "minimal" });

    const finder = mockPane?.pushed.render() as { props: Record<string, unknown> };
    expect(finder.props).toEqual(
      expect.objectContaining({ embedded: true, nativeHeader: true, requireBadge: true }),
    );
    await act(async () =>
      (finder.props.onSelect as (person: { badgeId: string }) => void)({ badgeId: "BADGE-1" }),
    );
    expect(mockPane?.pushed.open).toBe(false);
    await waitFor(() => expect(enqueueLocalScan).toHaveBeenCalled());
  });
});
