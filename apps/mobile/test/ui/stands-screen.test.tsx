let mockNfcStatus: "checking" | "supported" | "unsupported" = "supported";
jest.mock("@/lib/use-nfc-supported", () => ({
  useNfcSupportStatus: () => mockNfcStatus,
  useNfcSupported: () => mockNfcStatus === "supported",
}));

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { StandsScreen } from "@/components/stands-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { CompanyTagSessionOptions, CompanyTagWrite } from "@/lib/company-tag-nfc";
import type { StandSummary } from "@/lib/stands";
import { renderMobile } from "./render";

/**
 * The NFC session is mocked: a "tap" runs the screen's `link` callback with
 * the UID, then answers with the given write outcome. Real reads and NDEF
 * writes are covered by lib/company-tag-nfc.test.ts and need a physical
 * device.
 */
let mockTap: { uid: string; write: CompanyTagWrite } | null = null;
const mockSessions: CompanyTagSessionOptions[] = [];
jest.mock("@/lib/company-tag-nfc", () => ({
  startCompanyTagSession: (options: CompanyTagSessionOptions) => {
    mockSessions.push(options);
    const tap = mockTap;
    return {
      cancel: jest.fn(),
      result: (async () => {
        if (!tap) return null;
        if (options.link) await options.link(tap.uid);
        return tap;
      })(),
    };
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
  mockTap = { uid: "04A1B2C3D4E5F6", write: "written" };
  mockSessions.length = 0;
  mockNfcStatus = "supported";
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
  it("lists companies alphabetically with their codes and scannable state", async () => {
    await renderMobile(<StandsScreen />);
    await screen.findByText("Acme");
    const names = screen.getAllByText(/^(Acme|Zeta)$/).map((node) => node.props.children);
    expect(names).toEqual(["Acme", "Zeta"]);
    expect(screen.getByText("standsCounts:0/1")).toBeTruthy();
    expect(screen.getByText("standsNotScannable · standsCounts:0/0")).toBeTruthy();
  });

  it("links a tag by its serial on tap and says it now opens the app", async () => {
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    expect(await screen.findByText("standsLinkedOpens:Acme")).toBeTruthy();
    expect(mockSessions[0]).toMatchObject({ prompt: "standsNfcPrompt" });
    const call = fetchMock.mock.calls.find(([path]) => path === "/api/enterprises/1/stand-tags");
    expect(call?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ kind: "nfc", uid: "04A1B2C3D4E5F6" }),
    });
    expect((call?.[1]?.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    expect(screen.getByText("standsCounts:1/1")).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("links several tags in a row for the same company without leaving the screen", async () => {
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    await screen.findByText("standsLinkedOpens:Acme");
    mockTap = { uid: "04A1B2C3D4E5F7", write: "written" };
    await fireEvent.press(screen.getByText("standsLinkAnother"));
    await waitFor(() => expect(screen.getByText("standsCounts:2/1")).toBeTruthy());
    expect(mockSessions).toHaveLength(2);
  });

  it("says when a locked or read-only wristband was linked without the app link", async () => {
    mockTap = { uid: "04A1B2C3D4E5F6", write: "readOnly" };
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    expect(await screen.findByText("standsLinkedReadOnly:Acme")).toBeTruthy();
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

  it("asks before replacing other data and writes on a second tap of the same tag", async () => {
    mockTap = { uid: "04A1B2C3D4E5F6", write: "needsOverwrite" };
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, , buttons] = jest.mocked(Alert.alert).mock.calls[0] as [
      string,
      string,
      AlertButton[],
    ];
    expect(title).toBe("standsOverwriteTitle");
    mockTap = { uid: "04A1B2C3D4E5F6", write: "written" };
    await act(async () => buttons.find((b) => b.text === "standsOverwrite")?.onPress?.());
    expect(await screen.findByText("standsLinkedOpens:Acme")).toBeTruthy();
    expect(mockSessions[1]).toMatchObject({
      prompt: "standsTapAgain",
      expectedUid: "04A1B2C3D4E5F6",
      overwrite: true,
      link: undefined,
    });
  });

  it("keeps the tag's data when staff decline to replace it", async () => {
    mockTap = { uid: "04A1B2C3D4E5F6", write: "needsOverwrite" };
    await renderMobile(<StandsScreen />);
    await tapLink("Acme");
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const buttons = jest.mocked(Alert.alert).mock.calls[0]?.[2] as AlertButton[];
    await act(async () => buttons.find((b) => b.text === "standsKeep")?.onPress?.());
    expect(await screen.findByText("standsLinkedKept:Acme")).toBeTruthy();
    expect(mockSessions).toHaveLength(1);
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
