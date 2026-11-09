import { fireEvent, screen } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-router/stack", () => {
  const React = require("react");
  const { Pressable, View } = require("react-native");
  return {
    Stack: {
      Toolbar: Object.assign(View, {
        Button: ({
          accessibilityLabel,
          onPress,
        }: {
          accessibilityLabel: string;
          onPress: () => void;
        }) =>
          React.createElement(Pressable, {
            accessibilityRole: "button",
            accessibilityLabel,
            onPress,
          }),
        View,
        Spacer: () => null,
      }),
    },
  };
});
jest.mock("@/lib/api", () => ({ CLOCK_SKEW_TOLERANCE_MS: 60_000 }));
jest.mock("@/lib/scanner-db", () => ({
  listScannerPeople: async () => [],
  listScannerActivities: async () => [],
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/glass-view", () => ({ GlassView: require("react-native").View }));
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "black" }) }));

import { ScannerQueueStatus } from "@/components/scanner-transaction-status";
import type { PendingScan } from "@/lib/scanner-types";
import { renderMobile } from "./render";

const actions = {
  onSync: jest.fn(),
  onRetry: jest.fn(),
  onRetryOne: jest.fn(),
  onDelete: jest.fn(),
};

it("opens and closes the real empty queue from its native toolbar action", async () => {
  await renderMobile(<ScannerQueueStatus nativeToolbar queue={[]} syncing={false} {...actions} />);
  expect(screen.queryByText("scannerSeeHistory")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "scannerStateReady" }));
  expect(await screen.findByText("scannerSeeHistory")).toBeTruthy();
  expect(screen.getByRole("button", { name: "scannerSync" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "close" }));
  expect(screen.queryByText("scannerSeeHistory")).toBeNull();
});

it("shows pending work as Saved and provides synchronization in the opened panel", async () => {
  const scan: PendingScan = {
    id: "scan-1",
    kind: "activity",
    payload: {
      kind: "activity",
      badgeId: "BADGE-1",
      activityId: 7,
      allowRepeat: false,
      scannedAt: "2026-11-09T08:00:00Z",
    },
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: "2026-11-09T08:00:00Z",
    acknowledgedAt: null,
    clockCorrected: false,
  };
  await renderMobile(
    <ScannerQueueStatus nativeToolbar queue={[scan]} syncing={false} {...actions} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "scannerStateReady" }));
  expect(await screen.findByText("scannerStateSaved")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "scannerSync" }));
  expect(actions.onSync).toHaveBeenCalled();
});
