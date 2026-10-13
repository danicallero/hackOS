let mockNfcStatus: "checking" | "supported" | "unsupported" = "supported";
jest.mock("@/lib/use-nfc-supported", () => ({
  useNfcSupportStatus: () => mockNfcStatus,
  useNfcSupported: () => mockNfcStatus === "supported",
}));

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, AppState } from "react-native";
import { StandsScreen } from "@/components/stands-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { StandSummary } from "@/lib/stands";
import { renderMobile } from "./render";

/**
 * The NFC read is mocked: a "tap" resolves with the UID after the (mocked)
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
    tags: [],
    ...overrides,
  };
}

function conflict(usedBy: string) {
  return new (ApiError as unknown as new (m: string, s: number, c?: string, d?: unknown) => Error)(
    "in use",
    409,
    "conflict",
    { code: "stand_tag_in_use", usedBy },
  );
}

let stands: StandSummary[];
let linkResult: () => Promise<unknown>;

beforeEach(() => {
  mockTap = { uid: "04A1B2C3D4E5F6", claimFailed: false };
  mockReads.length = 0;
  mockNfcStatus = "supported";
  mockGlass = false;
  mockSetOptions.mockReset();
  mockPush.mockReset();
  mockCapabilities = [CAPABILITIES.SPONSORS_MANAGE];
  stands = [
    stand({ enterpriseId: 2, name: "Zeta", scannable: false, qrCount: 0 }),
    stand({ enterpriseId: 1, name: "Acme" }),
  ];
  linkResult = () =>
    Promise.resolve({ id: 9, kind: "nfc", code: "04A1B2C3D4E5F6", label: null, createdAt: "" });
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

async function tapLink(name: string) {
  await fireEvent.press(await screen.findByLabelText(`standsLinkNfcFor:${name}`));
}

describe("StandsScreen (#935)", () => {
  it("lists companies alphabetically with their counts and which are not scannable", async () => {
    await renderMobile(<StandsScreen />);
    await screen.findByText("Acme");
    const names = screen.getAllByText(/^(Acme|Zeta)$/).map((node) => node.props.children);
    expect(names).toEqual(["Acme", "Zeta"]);
    expect(screen.getByText("standsCounts:0/1")).toBeTruthy();
    expect(screen.getByLabelText("Zeta").props.accessibilityHint).toBe(
      "standsCounts:0/0, standsNotScannable",
    );
    expect(screen.getByLabelText("Acme").props.accessibilityHint).toBe("standsCounts:0/1");
  });

  it("opens a company's tags from its row", async () => {
    await renderMobile(<StandsScreen />);
    await fireEvent.press(await screen.findByLabelText("Zeta"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/others/stand/[id]",
      params: { id: "2", name: "Zeta" },
    });
  });

  it("searches companies from the native header search on iOS 26", async () => {
    mockGlass = true;
    await renderMobile(<StandsScreen />);
    await screen.findByText("Acme");
    const options = mockSetOptions.mock.calls.at(-1)?.[0];
    expect(options).toMatchObject({
      headerShown: true,
      headerSearchBarOptions: {
        placeholder: "standsSearchPlaceholder",
        placement: "integratedButton",
      },
    });
    await act(() => options.headerSearchBarOptions.onChangeText({ nativeEvent: { text: "zet" } }));
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.getByText("Zeta")).toBeTruthy();
    expect(screen.queryByLabelText("scheduleSearch")).toBeNull();
  });

  it("searches companies from the fallback header elsewhere", async () => {
    await renderMobile(<StandsScreen />);
    await screen.findByText("Acme");
    expect(mockSetOptions).toHaveBeenLastCalledWith({ headerShown: false });
    await fireEvent.press(screen.getByLabelText("scheduleSearch"));
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "ACM");
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.queryByText("Zeta")).toBeNull();
  });

  it("links a tag by its serial on tap, as the badge flow claims it", async () => {
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    expect(await screen.findByText("standsLinked:Acme")).toBeTruthy();
    expect(mockReads[0]).toMatchObject({ claimBadge: true });
    const call = fetchMock.mock.calls.find(([path]) => path === "/api/enterprises/1/stand-tags");
    expect(call?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ kind: "nfc", uid: "04A1B2C3D4E5F6" }),
    });
    expect(screen.getByText("standsCounts:1/1")).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("links several tags in a row for the same company without leaving the screen", async () => {
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    await screen.findByText("standsLinked:Acme");
    mockTap = { uid: "04A1B2C3D4E5F7", claimFailed: false };
    await fireEvent.press(screen.getByText("standsLinkAnother"));
    await waitFor(() => expect(screen.getByText("standsCounts:2/1")).toBeTruthy());
    expect(mockReads).toHaveLength(2);
  });

  it("says when the tag could not be prepared but is linked by serial", async () => {
    mockTap = { uid: "04A1B2C3D4E5F6", claimFailed: true };
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    expect(await screen.findByText("standsLinkedWriteFailed:Acme")).toBeTruthy();
  });

  it("refuses a wristband that is a badge and a tag of another company", async () => {
    linkResult = () => Promise.reject(conflict("badge"));
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith("standsLinkNfc", "standsTagIsBadge"),
    );
    linkResult = () => Promise.reject(conflict("stand"));
    await tapLink("Zeta");
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenLastCalledWith("standsLinkNfc", "standsTagIsStand"),
    );
    expect(screen.queryByText(/standsLinked/)).toBeNull();
  });

  it("keeps the iOS NFC sheet open when it makes the app inactive", async () => {
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      listeners.push(listener as (state: string) => void);
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    mockTap = "pending";
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    for (const listener of listeners) listener("inactive");
    expect(mockReads[0]?.cancel).not.toHaveBeenCalled();
    for (const listener of listeners) listener("background");
    expect(mockReads[0]?.cancel).toHaveBeenCalled();
  });

  it("shows localized copy, not the server message, for an unexpected link failure", async () => {
    linkResult = () => Promise.reject(new ApiError("Enterprise not found", 404, "not_found"));
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith("standsLinkNfc", "standsLinkFailed"),
    );
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
