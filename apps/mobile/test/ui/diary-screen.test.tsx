let mockNfcSupported = true;
jest.mock("@/lib/use-nfc-supported", () => ({ useNfcSupported: () => mockNfcSupported }));

import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { DiaryScreen } from "@/components/diary-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import { renderMobile } from "./render";

type MenuProps = {
  actions: { id: string }[];
  onPressAction: (event: { nativeEvent: { event: string } }) => void;
};
let mockMenus: MenuProps[] = [];
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: (props: MenuProps & { children: unknown }) => {
    mockMenus.push(props);
    return props.children;
  },
}));
let mockNfc: { visible: boolean; onValue: (uid: string) => void; onClose: () => void } | null =
  null;
jest.mock("@/components/nfc-reader", () => ({
  NfcReader: (props: { visible: boolean; onValue: (uid: string) => void; onClose: () => void }) => {
    mockNfc = props;
    return null;
  },
}));
let mockQrMounts = 0;
jest.mock("@/components/QrCamera", () => ({
  QrCamera: ({ onValue }: { onValue: (code: string) => void }) => {
    mockQrMounts += 1;
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="qr fixture"
        onPress={() => onValue("STAND-QR")}
      >
        <Text>QR</Text>
      </Pressable>
    );
  },
}));
jest.mock("expo-router", () => ({ useScrollToTop: () => {}, useIsFocused: () => true }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
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

function person(id: number, name: string, overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id,
    kind: "person",
    starred: false,
    note: null,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    person: {
      userId: 100 + id,
      displayName: name,
      photoUrl: null,
      headline: "Builds robots",
      locationNote: null,
      project: { kind: "project", id: 1, name: "Rover" },
      challenges: [{ id: 2, name: "Robotics" }],
    },
    sponsor: null,
    ...overrides,
  };
}

const sponsor: DiaryEntry = {
  ...person(3, "unused"),
  kind: "sponsor",
  person: null,
  sponsor: {
    enterpriseId: 9,
    name: "Acme",
    logoUrl: null,
    logoNegativeUrl: null,
    description: "We make things",
    website: "https://acme.test/",
    challenges: [],
  },
};

let diary: DiaryEntry[];
let scanResult: DiaryEntry | Error;

beforeEach(() => {
  mockNfcSupported = true;
  mockMenus = [];
  mockNfc = null;
  mockQrMounts = 0;
  diary = [person(1, "Ana S.", { starred: true }), person(2, "Hidden", { person: null }), sponsor];
  scanResult = person(4, "Bea R.");
  jest.mocked(apiFetch).mockReset();
  jest.mocked(apiFetch).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/me/diary") return { items: diary };
    if (path === "/api/me/diary/scan") {
      if (scanResult instanceof Error) throw scanResult;
      return scanResult;
    }
    if (init?.method === "PATCH") return { ...diary[0], ...JSON.parse(String(init.body)) };
    return undefined;
  });
});
afterEach(() => jest.restoreAllMocks());

function scanMenu(): MenuProps {
  const menu = [...mockMenus].reverse().find((m) => m.actions.some((a) => a.id === "manual"));
  if (!menu) throw new Error("scan menu not rendered");
  return menu;
}

function scanCalls() {
  return jest.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/me/diary/scan");
}

it("lists saved people and stands, showing hidden profiles only as unavailable", async () => {
  await renderMobile(<DiaryScreen />);
  expect(await screen.findByText("Ana S.")).toBeTruthy();
  expect(screen.getByText("Acme")).toBeTruthy();
  expect(screen.getByText("diaryUnavailablePerson")).toBeTruthy();
  expect(screen.queryByText("Hidden")).toBeNull();
  expect(screen.getByRole("button", { name: "diaryUnfavourite" })).toBeTruthy();
});

it("opens NFC with one tap and shows the saved card", async () => {
  await renderMobile(<DiaryScreen />);
  await screen.findByText("Ana S.");
  expect(mockNfc?.visible).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "diaryScanNfc" }));
  expect(mockNfc?.visible).toBe(true);
  // The real reader closes itself right after reporting the UID.
  await act(async () => {
    mockNfc?.onValue("04A1B2C3D4E5F6");
    mockNfc?.onClose();
  });
  await waitFor(() => expect(screen.getByText("diarySaved")).toBeTruthy());
  expect(screen.getByText("Bea R.")).toBeTruthy();
  const [, init] = scanCalls()[0] ?? [];
  expect(JSON.parse(String(init?.body))).toEqual({ code: "04A1B2C3D4E5F6" });
  expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toEqual(expect.any(String));
});

it("keeps QR and manual entry in the secondary menu", async () => {
  await renderMobile(<DiaryScreen />);
  await screen.findByText("Ana S.");
  expect(mockQrMounts).toBe(0);
  await act(() => scanMenu().onPressAction({ nativeEvent: { event: "manual" } }));
  await fireEvent.changeText(screen.getByLabelText("scannerManualEntryTitle"), "  STAND-CODE  ");
  await fireEvent.press(screen.getByRole("button", { name: "scannerManualEntrySubmit" }));
  await waitFor(() => expect(scanCalls()).toHaveLength(1));
  expect(JSON.parse(String(scanCalls()[0]?.[1]?.body))).toEqual({ code: "STAND-CODE" });
});

it("makes QR the primary action without NFC hardware", async () => {
  mockNfcSupported = false;
  await renderMobile(<DiaryScreen />);
  await screen.findByText("Ana S.");
  expect(screen.queryByRole("button", { name: "diaryScanNfc" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "personScanBadgeCode" }));
  expect(mockQrMounts).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole("button", { name: "qr fixture" }));
  await waitFor(() => expect(scanCalls()).toHaveLength(1));
});

it("explains a hidden profile without naming anyone and saves nothing", async () => {
  scanResult = new ApiError("x", 409, "profile_not_shared");
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await renderMobile(<DiaryScreen />);
  await screen.findByText("Ana S.");
  await fireEvent.press(screen.getByRole("button", { name: "diaryScanNfc" }));
  await act(async () => mockNfc?.onValue("04A1B2C3D4E5F6"));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("tabDiary", "diaryScanNotShared"));
  expect(screen.queryByText("diarySaved")).toBeNull();
});

it("submits nothing when the NFC reader is cancelled", async () => {
  await renderMobile(<DiaryScreen />);
  await screen.findByText("Ana S.");
  await fireEvent.press(screen.getByRole("button", { name: "diaryScanNfc" }));
  await act(async () => mockNfc?.onClose());
  expect(mockNfc?.visible).toBe(false);
  expect(scanCalls()).toHaveLength(0);
});

it("toggles a favourite through an idempotent PATCH", async () => {
  await renderMobile(<DiaryScreen />);
  await screen.findByText("Ana S.");
  await fireEvent.press(screen.getByRole("button", { name: "diaryUnfavourite" }));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/me/diary/1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ starred: false }) }),
    ),
  );
});
