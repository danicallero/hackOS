let mockNfcStatus: "checking" | "supported" | "unsupported" = "supported";
jest.mock("@/lib/use-nfc-supported", () => ({
  useNfcSupportStatus: () => mockNfcStatus,
  useNfcSupported: () => mockNfcStatus === "supported",
}));

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { StandsScreen } from "@/components/stands-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { StandSummary } from "@/lib/stands";
import { renderMobile } from "./render";

let mockNfc: { visible: boolean; onValue: (uid: string) => void; onClose: () => void } | null =
  null;
jest.mock("@/components/nfc-reader", () => ({
  NfcReader: (props: { visible: boolean; onValue: (uid: string) => void; onClose: () => void }) => {
    mockNfc = props;
    return null;
  },
}));
jest.mock("expo-router", () => ({
  useScrollToTop: () => {},
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
let mockCapabilities: string[] = [];
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { capabilities: mockCapabilities } }),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join("/")}` : key,
  }),
}));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;
    constructor(message: string, status: number, code?: string, details?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("@/lib/router-tabs-inset", () => ({
  useRouterTabBarBottomInset: () => 0,
  useRouterTabBarScrollBottomInset: () => 0,
}));

const fetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

function stand(overrides: Partial<StandSummary>): StandSummary {
  return {
    enterpriseId: 1,
    name: "Acme",
    logoUrl: null,
    logoNegativeUrl: null,
    visibility: "visible",
    availableFrom: null,
    scannable: true,
    nfcCount: 0,
    qrCount: 1,
    latestQrTagId: 3,
    ...overrides,
  };
}

let stands: StandSummary[];
let linkResult: () => Promise<unknown>;

beforeEach(() => {
  mockNfc = null;
  mockNfcStatus = "supported";
  mockCapabilities = [CAPABILITIES.SPONSORS_MANAGE];
  stands = [
    stand({ enterpriseId: 2, name: "Zeta", scannable: false, qrCount: 0 }),
    stand({ enterpriseId: 1, name: "Acme" }),
  ];
  linkResult = () => Promise.resolve({ id: 9, kind: "nfc", code: "04A1B2C3D4E5F6" });
  fetchMock.mockReset();
  fetchMock.mockImplementation(((path: string) =>
    path === "/api/enterprises/stands"
      ? Promise.resolve({ stands })
      : linkResult()) as typeof apiFetch);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StandsScreen (#935)", () => {
  it("lists enterprises alphabetically with their codes and scannable state", async () => {
    await renderMobile(<StandsScreen />);
    await screen.findByText("Acme");
    const names = screen.getAllByText(/^(Acme|Zeta)$/).map((node) => node.props.children);
    expect(names).toEqual(["Acme", "Zeta"]);
    expect(screen.getByText("standsCounts:0/1")).toBeTruthy();
    expect(screen.getByText("standsNotScannable · standsCounts:0/0")).toBeTruthy();
  });

  it("reads a tag on tap and links it to the chosen stand", async () => {
    await renderMobile(<StandsScreen />);
    await fireEvent.press(await screen.findByLabelText("standsLinkNfcFor:Acme"));
    expect(mockNfc?.visible).toBe(true);
    await act(async () => {
      mockNfc?.onValue("04A1B2C3D4E5F6");
      mockNfc?.onClose();
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/enterprises/1/stand-tags",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ kind: "nfc", uid: "04A1B2C3D4E5F6" }),
        }),
      ),
    );
    const call = fetchMock.mock.calls.find(([path]) => path === "/api/enterprises/1/stand-tags");
    expect((call?.[1]?.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    expect(await screen.findByText("standsLinked:Acme")).toBeTruthy();
    expect(screen.getByText("standsCounts:1/1")).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("says when the tag is already a badge or already a stand", async () => {
    linkResult = () =>
      Promise.reject(
        new (ApiError as unknown as new (m: string, s: number, c?: string, d?: unknown) => Error)(
          "in use",
          409,
          "conflict",
          { code: "stand_tag_in_use", usedBy: "badge" },
        ),
      );
    await renderMobile(<StandsScreen />);
    await fireEvent.press(await screen.findByLabelText("standsLinkNfcFor:Acme"));
    await act(async () => mockNfc?.onValue("04A1B2C3D4E5F6"));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith("standsLinkNfc", "standsTagIsBadge"),
    );

    linkResult = () =>
      Promise.reject(
        new (ApiError as unknown as new (m: string, s: number, c?: string, d?: unknown) => Error)(
          "in use",
          409,
          "conflict",
          { code: "stand_tag_in_use", usedBy: "stand" },
        ),
      );
    await act(async () => mockNfc?.onClose());
    await fireEvent.press(screen.getByLabelText("standsLinkNfcFor:Zeta"));
    await act(async () => mockNfc?.onValue("04A1B2C3D4E5F7"));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenLastCalledWith("standsLinkNfc", "standsTagIsStand"),
    );
    expect(screen.queryByText(/standsLinked/)).toBeNull();
  });

  it("explains a device without NFC and keeps the action disabled", async () => {
    mockNfcStatus = "unsupported";
    await renderMobile(<StandsScreen />);
    expect(await screen.findByText("standsNfcUnavailable")).toBeTruthy();
    const action = screen.getByLabelText("standsLinkNfcFor:Acme");
    expect(action.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("is staff only and does not load without sponsors:manage", async () => {
    mockCapabilities = [CAPABILITIES.ACCREDIT_SCAN];
    await renderMobile(<StandsScreen />);
    expect(screen.getByText("requestUnavailable")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
