import { act, screen } from "@testing-library/react-native";

const mockApiFetch = jest.fn();
const mockReadCachedValue = jest.fn();

jest.mock("expo-router", () => ({ useScrollToTop: jest.fn() }));
jest.mock("react-native-gesture-handler", () => {
  const actual = jest.requireActual("react-native-gesture-handler");
  const gesture: object = new Proxy({}, { get: () => () => gesture });
  return {
    ...actual,
    Gesture: { Native: () => gesture, Pan: () => gesture },
    GestureDetector: ({ children }: { children: unknown }) => children,
  };
});
jest.mock("@premieroctet/react-native-wallet", () => ({
  ButtonStyle: {},
  ButtonType: {},
  RNWalletView: () => null,
}));
jest.mock("expo-device", () => ({ deviceType: 1, DeviceType: { PHONE: 1 } }));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: {} }));
jest.mock("expo-sharing", () => ({}));
jest.mock("react-native-qrcode-svg", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return ({ value }: { value: string }) =>
    ReactLib.createElement(Native.Text, { testID: "wallet-qr" }, value);
});
jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  const Text = ({ children }: { children?: unknown }) =>
    ReactLib.createElement(Native.Text, null, children);
  return {
    ActionButton: ({ label }: { label: string }) => Text({ children: label }),
    EmptyState: ({ title }: { title: string }) => Text({ children: title }),
    InfoRow: ({ value }: { value: string }) => Text({ children: value }),
    Section: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.View, null, children),
    Separator: () => null,
  };
});
jest.mock("@/components/RequestFeedback", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    RequestFeedback: ({ loading }: { loading?: boolean }) =>
      loading ? ReactLib.createElement(Native.Text, null, "loading") : null,
  };
});
jest.mock("@/components/segmented-control", () => ({ SegmentedControl: () => null }));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));
jest.mock("@/lib/auth-client", () => ({ authClient: { getCookie: () => null } }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
jest.mock("@/lib/idempotency-key", () => ({ createIdempotencyKey: () => "key" }));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 7 }, refetch: jest.fn() }),
}));
jest.mock("@/lib/offline-cache", () => ({
  readCachedValue: (...args: unknown[]) => mockReadCachedValue(...args),
  writeCachedValue: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/lib/self-service", () => ({ declineOwnSpot: jest.fn() }));
jest.mock("@/lib/server-events", () => ({
  isServerEventConnected: () => true,
  subscribeToServerEvent: () => () => undefined,
}));
jest.mock("@/lib/use-retry-on-reconnect", () => ({ useRetryOnReconnect: jest.fn() }));
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#000000" }) }));
jest.mock("@/lib/wallet-platform", () => ({
  ANDROID_PKPASS_MIME_TYPES: [],
  PKPASS_MIME_TYPE: "application/vnd.apple.pkpass",
  resolveAppleWalletPass: jest.fn(),
  supportsAppleWalletButton: () => false,
  supportsAppleWalletFileHandoff: () => false,
}));

import WalletScreen from "@/components/wallet-screen";
import { renderMobile } from "./render";

const cachedTicket = {
  userId: 7,
  ticketToken: "cached-ticket-token",
  badgeId: null,
  applePassTypeIdentifier: "pass.test",
  applePassSerialNumbers: { ticket: null, badge: null },
  acceptedSpots: [],
};

describe("WalletScreen offline ticket (H28)", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockReadCachedValue.mockReset();
  });

  it("shows the cached QR while the server has not answered", async () => {
    // A down or hanging server: the request never settles.
    mockApiFetch.mockReturnValue(new Promise(() => undefined));
    mockReadCachedValue.mockResolvedValue({
      data: cachedTicket,
      updatedAt: "2026-10-10T10:00:00.000Z",
    });

    await renderMobile(<WalletScreen />);
    await act(async () => undefined);

    expect(mockReadCachedValue).toHaveBeenCalledWith("user:7:wallet");
    expect(screen.getByTestId("wallet-qr")).toHaveTextContent("cached-ticket-token");
    expect(screen.queryByText("loading")).toBeNull();
  });

  it("shows loading when nothing is cached yet", async () => {
    mockApiFetch.mockReturnValue(new Promise(() => undefined));
    mockReadCachedValue.mockResolvedValue(null);

    await renderMobile(<WalletScreen />);
    await act(async () => undefined);

    expect(screen.getByText("loading")).toBeTruthy();
    expect(screen.queryByTestId("wallet-qr")).toBeNull();
  });
});
