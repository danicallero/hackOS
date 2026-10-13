jest.mock("@/components/scanner-action-button", () =>
  jest.requireActual("@/components/scanner-action-button.tsx"),
);

import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";

let mockParams: { id: string; manualBadge?: string; manualNonce?: string } = {
  id: "7",
  manualBadge: "BADGE-1",
  manualNonce: "1",
};
let mockFocused = true;
let mockNfcSupport = "supported";
let mockReaderProps: {
  showAndroidOverlay: boolean;
  visible: boolean;
  onValue: (value: string) => void;
  onClose: () => void;
};
const mockCamera = jest.fn((_props: unknown) =>
  require("react").createElement(require("react-native").View, { testID: "qr-fallback" }),
);

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => mockFocused,
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
jest.mock("@/components/QrCamera", () => ({ QrCamera: (props: unknown) => mockCamera(props) }));
jest.mock("@/components/scanner-code-entry", () => ({ ScannerCodeEntry: () => null }));
jest.mock("@/components/nfc-reader", () => ({
  NfcReader: (props: typeof mockReaderProps) => {
    mockReaderProps = props;
    return null;
  },
}));
jest.mock("@/lib/use-nfc-supported", () => ({ useNfcSupportStatus: () => mockNfcSupport }));
jest.mock("@/components/scanner-transaction-status", () => ({ ScannerQueueStatus: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn().mockResolvedValue({ items: [] }) }));
jest.mock("@/lib/live-activities/sync", () => ({ bumpActivityScanned: jest.fn() }));
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
        scannerRepeatNoAdd: "Do not add",
        scannerRepeatAdd: "Add another",
        scannerRepeatBody: "This person already has {count} scan(s). Allow a repeat?",
        accountNotSet: "Account not set",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { id: 11 } }) }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarBottomInset: () => 0 }));
jest.mock("@/lib/scanner-db", () => ({
  enqueueLocalScan: jest.fn().mockResolvedValue("scan-1"),
  findPersonByTicket: jest.fn().mockResolvedValue(null),
  findPersonByBadge: jest.fn().mockResolvedValue({
    person: {
      userId: 21,
      email: "ada@example.com",
      role: "participant",
      hasCapabilities: false,
      isEnterpriseJudge: false,
      eventAccess: true,
      ticketToken: null,
      badgeId: "BADGE-1",
      revokedBadgeIds: [],
      name: "Ada",
      surname: "Lovelace",
      dni: null,
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
  listScannerPeople: jest
    .fn()
    .mockResolvedValue([{ lastPresenceKind: "in" }, { lastPresenceKind: "out" }]),
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
import {
  enqueueLocalScan,
  findPersonByBadge,
  findPersonByTicket,
  getActivityState,
  listScannerActivities,
  pendingScans,
} from "@/lib/scanner-db";
import { renderMobile } from "./render";

beforeEach(() => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => jest.restoreAllMocks());

describe("activity scanner result (H26)", () => {
  it("offers Close after a first scan", async () => {
    await renderMobile(<ActivityScannerScreen />);

    const close = await screen.findByRole("button", { name: "Close" });
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();

    await fireEvent.press(close);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close" })).toBeNull());
  });

  it("asks before queuing a repeated registrable-activity scan", async () => {
    jest.mocked(enqueueLocalScan).mockClear();
    jest.mocked(getActivityState).mockResolvedValueOnce({ userId: 21, activityId: 7, count: 1 });

    await renderMobile(<ActivityScannerScreen />);

    expect(await screen.findByRole("button", { name: "Add another" })).toBeTruthy();
    expect(enqueueLocalScan).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Add another" }));
    await waitFor(() =>
      expect(enqueueLocalScan).toHaveBeenCalledWith(
        expect.objectContaining({ allowRepeat: true, kind: "activity" }),
        11,
      ),
    );
  });
});

it("keeps an offline meal scan saved and asks before another serving", async () => {
  const activities = await listScannerActivities();
  jest
    .mocked(listScannerActivities)
    .mockResolvedValueOnce([{ ...activities[0]!, category: "meal" }]);
  jest.mocked(pendingScans).mockResolvedValueOnce([]);
  await renderMobile(<ActivityScannerScreen />);
  expect(await screen.findByText("Saved")).toBeTruthy();
  expect(screen.queryByText("Confirmed")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  jest.mocked(getActivityState).mockResolvedValueOnce({ userId: 21, activityId: 7, count: 1 });
  jest.mocked(enqueueLocalScan).mockClear();
  await act(() => mockReaderProps.onValue("BADGE-1"));
  expect(await screen.findByRole("button", { name: "Add another" })).toBeTruthy();
  expect(enqueueLocalScan).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Add another" }));
  await waitFor(() =>
    expect(enqueueLocalScan).toHaveBeenCalledWith(
      expect.objectContaining({ allowRepeat: true }),
      11,
    ),
  );
});

it("accepts a ticket QR and preserves it in the offline activity payload", async () => {
  jest.mocked(enqueueLocalScan).mockClear();
  const badge = await findPersonByBadge("BADGE-1");
  jest
    .mocked(findPersonByTicket)
    .mockResolvedValueOnce({ ...badge.person!, badgeId: null, ticketToken: "BADGE-1" });
  await renderMobile(<ActivityScannerScreen />);
  await screen.findByRole("button", { name: "Close" });
  expect(enqueueLocalScan).toHaveBeenCalledWith(
    expect.objectContaining({ ticketToken: "BADGE-1", kind: "activity" }),
    11,
  );
});

it("automatically dismisses lookup errors after six seconds", async () => {
  jest.mocked(findPersonByBadge).mockResolvedValueOnce({ person: null, revoked: false });
  jest.useFakeTimers();
  try {
    await renderMobile(<ActivityScannerScreen />);
    await screen.findByRole("button", { name: "scannerBadgeUnknown" });
    await act(() => jest.advanceTimersByTime(6000));
    expect(screen.queryByRole("button", { name: "scannerBadgeUnknown" })).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

describe("manual activity NFC sessions (H25/H26)", () => {
  beforeEach(() => {
    mockParams = { id: "7" };
    mockFocused = true;
    mockNfcSupport = "supported";
    mockCamera.mockClear();
  });
  afterEach(() => {
    mockParams = { id: "7", manualBadge: "BADGE-1", manualNonce: "1" };
    mockFocused = true;
    mockNfcSupport = "supported";
    jest.useRealTimers();
  });

  it("arrives idle without mounting the camera or opening NFC", async () => {
    await renderMobile(<ActivityScannerScreen />);
    await screen.findByText("Workshop");
    expect(mockReaderProps.visible).toBe(false);
    expect(mockCamera).not.toHaveBeenCalled();
    expect(screen.getByText("1")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "scannerCamera" }));
    expect(mockCamera).toHaveBeenCalledWith(
      expect.objectContaining({ hideNfc: true, requestCameraOnFocus: true, autoStartNfc: false }),
    );
  });

  it("shows NFC unavailable on unsupported hardware with accessible alternatives", async () => {
    mockNfcSupport = "unsupported";
    await renderMobile(<ActivityScannerScreen />);
    await screen.findByText("Workshop");
    expect(screen.getByText("scannerNfcUnavailable")).toBeTruthy();
    expect(screen.queryByText("scannerNfcIdle")).toBeNull();
    expect(screen.queryByRole("button", { name: "scannerNfcStart" })).toBeNull();
    expect(screen.getByRole("button", { name: "scannerCamera" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "scannerEnterManually" })).toBeTruthy();
  });

  it("closes the full-screen camera after one code and returns to the activity", async () => {
    await renderMobile(<ActivityScannerScreen />);
    await screen.findByText("Workshop");
    await fireEvent.press(screen.getByRole("button", { name: "scannerCamera" }));
    expect(screen.getByTestId("qr-fallback")).toBeTruthy();
    const props = mockCamera.mock.calls.at(-1)?.[0] as unknown as {
      onValue: (value: string) => void;
    };
    await act(() => props.onValue("BADGE-1"));
    await screen.findByRole("button", { name: "Close" });
    expect(screen.queryByTestId("qr-fallback")).toBeNull();
  });

  it("starts explicitly, reopens after a successful read, and stays stopped", async () => {
    jest.mocked(findPersonByBadge).mockResolvedValueOnce({ person: null, revoked: false });
    jest.useFakeTimers();
    await renderMobile(<ActivityScannerScreen />);
    await screen.findByText("Workshop");
    await fireEvent.press(screen.getAllByRole("button", { name: "scannerNfcStart" })[0]!);
    expect(mockReaderProps.visible).toBe(true);
    await act(async () => {
      mockReaderProps.onValue("UNKNOWN");
      mockReaderProps.onClose();
    });
    expect(mockReaderProps.visible).toBe(false);
    await act(() => jest.advanceTimersByTime(500));
    expect(mockReaderProps.visible).toBe(true);
    await fireEvent.press(screen.getAllByRole("button", { name: "scannerNfcStop" })[0]!);
    await act(() => jest.advanceTimersByTime(1000));
    expect(mockReaderProps.visible).toBe(false);
    expect(mockCamera).not.toHaveBeenCalled();
  });

  it("stops when the NFC reader is cancelled", async () => {
    await renderMobile(<ActivityScannerScreen />);
    await screen.findByText("Workshop");
    await fireEvent.press(screen.getAllByRole("button", { name: "scannerNfcStart" })[0]!);
    await act(() => mockReaderProps.onClose());
    expect(mockReaderProps.visible).toBe(false);
    expect(screen.getAllByRole("button", { name: "scannerNfcStart" })[0]!).toBeTruthy();
  });

  it("pauses for repeated scans and resumes after the operator closes the result", async () => {
    jest.mocked(getActivityState).mockResolvedValueOnce({ userId: 21, activityId: 7, count: 1 });
    jest.mocked(enqueueLocalScan).mockClear();
    await renderMobile(<ActivityScannerScreen />);
    await screen.findByText("Workshop");
    await fireEvent.press(screen.getAllByRole("button", { name: "scannerNfcStart" })[0]!);
    await act(() => mockReaderProps.onValue("BADGE-1"));
    await screen.findByRole("button", { name: "Do not add" });
    expect(mockReaderProps.visible).toBe(false);
    expect(enqueueLocalScan).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Do not add" }));
    await waitFor(() => expect(mockReaderProps.visible).toBe(true));
  });

  it("stops on background without reopening", async () => {
    let onState: (state: AppStateStatus) => void = () => {};
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
      onState = callback;
      return { remove: jest.fn() };
    });
    try {
      await renderMobile(<ActivityScannerScreen />);
      await screen.findByText("Workshop");
      await fireEvent.press(screen.getAllByRole("button", { name: "scannerNfcStart" })[0]!);
      await act(() => onState("background"));
      expect(mockReaderProps.visible).toBe(false);
      await act(() => onState("active"));
      expect(mockReaderProps.visible).toBe(false);
      expect(screen.getAllByRole("button", { name: "scannerNfcStart" })[0]!).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("stops on navigation and requires a fresh start when focus returns", async () => {
    let rerender = () => {};
    function Screen() {
      const [, update] = useState(0);
      rerender = () => update((value) => value + 1);
      return <ActivityScannerScreen />;
    }
    await renderMobile(<Screen />);
    await screen.findByText("Workshop");
    await fireEvent.press(screen.getAllByRole("button", { name: "scannerNfcStart" })[0]!);
    mockFocused = false;
    await act(rerender);
    expect(mockReaderProps.visible).toBe(false);
    mockFocused = true;
    await act(rerender);
    expect(mockReaderProps.visible).toBe(false);
    expect(screen.getAllByRole("button", { name: "scannerNfcStart" })[0]!).toBeTruthy();
  });
});

it("starts Android activity NFC on entry without a session button or overlay", async () => {
  const originalOS = Platform.OS;
  Platform.OS = "android";
  mockParams = { id: "7" };
  try {
    await renderMobile(<ActivityScannerScreen />);
    await screen.findByText("Workshop");
    await waitFor(() => expect(mockReaderProps.visible).toBe(true));
    expect(mockReaderProps.showAndroidOverlay).toBe(false);
    expect(screen.getAllByRole("button", { name: "scannerNfcStop" })).toHaveLength(1);
    expect(screen.queryByText("scannerNfcStop")).toBeNull();
    await fireEvent.press(screen.getByTestId("scanner-nfc-toggle"));
    expect(mockReaderProps.visible).toBe(false);
    await fireEvent.press(screen.getByTestId("scanner-nfc-toggle"));
    expect(mockReaderProps.visible).toBe(true);
  } finally {
    Platform.OS = originalOS;
  }
});
