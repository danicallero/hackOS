let mockNfcStatus: "checking" | "supported" | "unsupported" = "supported";
jest.mock("@/lib/use-nfc-supported", () => ({
  useNfcSupportStatus: () => mockNfcStatus,
  useNfcSupported: () => mockNfcStatus === "supported",
}));

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { StandDetailScreen } from "@/components/stand-detail-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { StandSummary, StandTag } from "@/lib/stands";
import { renderMobile } from "./render";

/**
 * #935 company detail. The NFC read is mocked: a "tap" resolves with the UID after the (mocked)
 * claim write, as the real reader does; the screen links it afterwards. Reads
 * and claim writes are covered by lib/nfc-reader.test.ts and need a device.
 */
let mockTap: { uid: string; claimFailed: boolean } | "pending" | null = null;
const mockReads: { claimBadge?: boolean; cancel?: jest.Mock }[] = [];
jest.mock("@/lib/nfc-reader", () => ({
  startNfcRead: (_message: string, options: { claimBadge?: boolean }) => {
    const tap = mockTap;
    const cancel = jest.fn();
    mockReads.push({ ...options, cancel });
    return {
      cancel,
      claimFailed: () => typeof tap === "object" && tap?.claimFailed === true,
      // "pending": the Core NFC sheet is still waiting for a tag.
      result:
        tap === "pending"
          ? new Promise<string | null>(() => {})
          : Promise.resolve(tap?.uid ?? null),
    };
  },
}));
const mockSetOptions = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useScrollToTop: () => {},
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({ id: "1", name: "Acme" }),
}));
let mockGlass = false;
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => mockGlass,
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

const nfc: StandTag = {
  id: 4,
  kind: "nfc",
  code: "04AABBCCDDEEFF",
  label: "Lanyard Ana",
  createdAt: "",
};
const qr: StandTag = { id: 5, kind: "qr", code: "STAND-ABC", label: null, createdAt: "" };

function acme(overrides: Partial<StandSummary> = {}): StandSummary {
  return {
    enterpriseId: 1,
    name: "Acme",
    logoUrl: null,
    logoNegativeUrl: null,
    visibility: "visible",
    availableFrom: null,
    scannable: true,
    nfcCount: 1,
    qrCount: 1,
    latestQrTagId: 5,
    tags: [nfc, qr],
    ...overrides,
  };
}

let stands: StandSummary[];
let mutation: (path: string, init?: { method?: string }) => Promise<unknown>;

/** Presses the confirmation's destructive button, as tapping Remove would. */
async function confirmAlert() {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  await act(async () => buttons?.find((button) => button.style === "destructive")?.onPress?.());
}

beforeEach(() => {
  mockTap = { uid: "04A1B2C3D4E5F6", claimFailed: false };
  mockReads.length = 0;
  mockNfcStatus = "supported";
  mockGlass = false;
  mockSetOptions.mockReset();
  mockCapabilities = [CAPABILITIES.SPONSORS_MANAGE];
  stands = [acme(), acme({ enterpriseId: 2, name: "Zeta", tags: [] })];
  mutation = () => Promise.resolve(undefined);
  fetchMock.mockReset();
  fetchMock.mockImplementation(((path: string, init?: { method?: string }) =>
    path === "/api/enterprises/stands"
      ? Promise.resolve({ stands })
      : mutation(path, init)) as typeof apiFetch);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StandDetailScreen (#935)", () => {
  it("titles the screen with the company and lists its NFC tags and QR codes", async () => {
    await renderMobile(<StandDetailScreen />);
    expect(await screen.findByText("standsNfcTags")).toBeTruthy();
    expect(screen.getByText("standsQrCodes")).toBeTruthy();
    expect(screen.getByLabelText("Lanyard Ana, 04AABBCCDDEEFF")).toBeTruthy();
    expect(screen.getByLabelText("STAND-ABC")).toBeTruthy();
    expect(mockSetOptions).toHaveBeenLastCalledWith({ title: "Acme" });
    expect(screen.getByLabelText("standsScannableFor:Acme").props.value).toBe(true);
  });

  it("shows an empty state for a company without tags", async () => {
    stands = [acme({ tags: [], nfcCount: 0, qrCount: 0 })];
    await renderMobile(<StandDetailScreen />);
    expect(await screen.findByText("standsNoTags")).toBeTruthy();
    expect(screen.queryByText("standsNfcTags")).toBeNull();
  });

  it("turns scanning off and explains what that means", async () => {
    await renderMobile(<StandDetailScreen />);
    await fireEvent(await screen.findByLabelText("standsScannableFor:Acme"), "valueChange", false);
    expect(screen.getByLabelText("standsScannableFor:Acme").props.value).toBe(false);
    expect(screen.getByText("standsNotScannableNotice")).toBeTruthy();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path]) => path === "/api/enterprises/1/stand-scannable",
      );
      expect(call?.[1]).toMatchObject({
        method: "PUT",
        body: JSON.stringify({ scannable: false }),
      });
    });
  });

  it("rolls the switch back and alerts when the change fails", async () => {
    mutation = () => Promise.reject(new Error("boom"));
    await renderMobile(<StandDetailScreen />);
    await fireEvent(await screen.findByLabelText("standsScannableFor:Acme"), "valueChange", false);
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith("standsTitle", "standsScannableFailed"),
    );
    expect(screen.getByLabelText("standsScannableFor:Acme").props.value).toBe(true);
  });

  it("removes an NFC tag only after the confirmation", async () => {
    await renderMobile(<StandDetailScreen />);
    const row = await screen.findByLabelText("Lanyard Ana, 04AABBCCDDEEFF");
    await fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "remove" } });
    expect(Alert.alert).toHaveBeenCalledWith(
      "standsRemoveTagConfirm",
      undefined,
      expect.any(Array),
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await confirmAlert();
    await waitFor(() => expect(screen.queryByLabelText("Lanyard Ana, 04AABBCCDDEEFF")).toBeNull());
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(call?.[0]).toBe("/api/enterprises/1/stand-tags/4");
    expect(screen.queryByText("standsNfcTags")).toBeNull();
  });

  it("warns that printed copies stop working before removing a QR code", async () => {
    await renderMobile(<StandDetailScreen />);
    await fireEvent(await screen.findByLabelText("STAND-ABC"), "accessibilityAction", {
      nativeEvent: { actionName: "remove" },
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "standsRemoveTagConfirm",
      "standsRemoveQrDetail",
      expect.any(Array),
    );
  });

  it("keeps the tag and shows the localized fallback when removing fails", async () => {
    mutation = () => Promise.reject(new ApiError("Tag not found", 404, "not_found"));
    await renderMobile(<StandDetailScreen />);
    await fireEvent(await screen.findByLabelText("STAND-ABC"), "accessibilityAction", {
      nativeEvent: { actionName: "remove" },
    });
    await confirmAlert();
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenLastCalledWith("standsRemoveTag", "standsRemoveTagFailed"),
    );
    expect(screen.getByLabelText("STAND-ABC")).toBeTruthy();
  });

  it("links a tag from the company and lists it at once", async () => {
    mutation = () =>
      Promise.resolve({ id: 9, kind: "nfc", code: "04A1B2C3D4E5F6", label: null, createdAt: "" });
    await renderMobile(<StandDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("standsLinkNfc"));
    expect(await screen.findByText("standsLinked:Acme")).toBeTruthy();
    expect(mockReads[0]).toMatchObject({ claimBadge: true });
    expect(screen.getByLabelText("04A1B2C3D4E5F6")).toBeTruthy();
  });

  it("keeps Link tag disabled on a device without NFC", async () => {
    mockNfcStatus = "unsupported";
    await renderMobile(<StandDetailScreen />);
    expect(await screen.findByText("standsNfcUnavailable")).toBeTruthy();
    expect(screen.getByLabelText("standsLinkNfc").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it("is staff only and does not load without sponsors:manage", async () => {
    mockCapabilities = [CAPABILITIES.ACCREDIT_SCAN];
    await renderMobile(<StandDetailScreen />);
    expect(screen.getByText("requestUnavailable")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
