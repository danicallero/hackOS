let mockNfcSupported = true;
jest.mock("@/lib/use-nfc-supported", () => ({ useNfcSupported: () => mockNfcSupported }));

import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { DiaryScreen } from "@/components/diary-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import type { SponsorCollection } from "@/lib/diary-sponsors";
import { renderMobile } from "./render";

type MenuProps = {
  actions: { id: string; title: string }[];
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
const mockPush = jest.fn();
let mockParams: { view?: string } = {};
jest.mock("expo-router", () => ({
  useScrollToTop: () => {},
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
let mockCapabilities: string[] = [];
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { capabilities: mockCapabilities } }),
}));
jest.mock("@/components/segmented-control", () => ({
  SegmentedControl: ({
    values,
    onChange,
  }: {
    values: string[];
    onChange: (index: number) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return values.map((value, index) => (
      <Pressable
        key={value}
        accessibilityRole="tab"
        accessibilityLabel={value}
        onPress={() => onChange(index)}
      >
        <Text>{value}</Text>
      </Pressable>
    ));
  },
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
  getCurrentSessionCookie: () => "session=1",
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
jest.mock("react-native-svg", () => {
  const { View } = require("react-native");
  return { __esModule: true, default: View, Path: View, Circle: View };
});
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

const sponsorEntry: DiaryEntry = {
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

function company(enterpriseId: number, name: string, entryId: number | null) {
  return {
    enterpriseId,
    name,
    logoUrl: null,
    logoNegativeUrl: null,
    description: `${name} description`,
    website: null,
    challenges: [{ id: 1, name: "Vision" }],
    entry:
      entryId === null
        ? null
        : { id: entryId, starred: false, note: null, createdAt: "2026-10-10T10:00:00.000Z" },
  };
}

let diary: DiaryEntry[];
let collection: SponsorCollection;
let scanResult: DiaryEntry | Error;

beforeEach(() => {
  mockNfcSupported = true;
  mockCapabilities = [];
  mockParams = {};
  mockPush.mockReset();
  mockMenus = [];
  mockNfc = null;
  mockQrMounts = 0;
  diary = [
    person(1, "Ana S.", { starred: true }),
    person(2, "Hidden", { person: null }),
    sponsorEntry,
  ];
  collection = {
    total: 2,
    collected: 1,
    items: [company(9, "Acme", 3), company(10, "Zeta", null)],
  };
  scanResult = person(4, "Bea R.");
  jest.mocked(apiFetch).mockReset();
  jest.mocked(apiFetch).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/me/diary") return { items: diary };
    if (path === "/api/me/diary/sponsors") return collection;
    if (path === "/api/me/diary/scan") {
      if (scanResult instanceof Error) throw scanResult;
      return scanResult;
    }
    if (init?.method === "PATCH") {
      const id = Number(path.split("/").pop());
      const current = diary.find((entry) => entry.id === id) ?? diary[0];
      return { ...current, ...JSON.parse(String(init.body)) };
    }
    return undefined;
  });
});
afterEach(() => jest.restoreAllMocks());

function menuWith(actionId: string): MenuProps {
  const menu = [...mockMenus].reverse().find((m) => m.actions.some((a) => a.id === actionId));
  if (!menu) throw new Error(`menu with ${actionId} not rendered`);
  return menu;
}

function calls(path: string) {
  return jest.mocked(apiFetch).mock.calls.filter(([called]) => called === path);
}

describe("People", () => {
  it("lists saved people only; stands live in Companies", async () => {
    await renderMobile(<DiaryScreen />);
    expect(await screen.findByText("Ana S.")).toBeTruthy();
    expect(screen.getByText("diaryUnavailablePerson")).toBeTruthy();
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.getByRole("button", { name: "diaryUnfavourite, Ana S." })).toBeTruthy();
  });

  it("opens NFC with one tap and pins the newly saved person", async () => {
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    expect(mockNfc?.visible).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "diaryScanNfc" }));
    expect(mockNfc?.visible).toBe(true);
    await act(async () => {
      mockNfc?.onValue("04A1B2C3D4E5F6");
      mockNfc?.onClose();
    });
    await waitFor(() => expect(screen.getByText("diarySaved")).toBeTruthy());
    expect(screen.getByText("Bea R.")).toBeTruthy();
    const [, init] = calls("/api/me/diary/scan")[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ code: "04A1B2C3D4E5F6" });
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toEqual(
      expect.any(String),
    );
  });

  it("keeps QR and manual entry in the secondary menu", async () => {
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    expect(mockQrMounts).toBe(0);
    await act(() => menuWith("manual").onPressAction({ nativeEvent: { event: "manual" } }));
    await fireEvent.changeText(screen.getByLabelText("scannerManualEntryTitle"), "  STAND-CODE  ");
    await fireEvent.press(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(calls("/api/me/diary/scan")).toHaveLength(1));
    expect(JSON.parse(String(calls("/api/me/diary/scan")[0]?.[1]?.body))).toEqual({
      code: "STAND-CODE",
    });
  });

  it("makes QR the primary action without NFC hardware", async () => {
    mockNfcSupported = false;
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    expect(screen.queryByRole("button", { name: "diaryScanNfc" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "personScanBadgeCode" }));
    expect(mockQrMounts).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole("button", { name: "qr fixture" }));
    await waitFor(() => expect(calls("/api/me/diary/scan")).toHaveLength(1));
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
    expect(calls("/api/me/diary/scan")).toHaveLength(0);
  });

  it("un-favouriting keeps the person saved, even with dates revived by the client", async () => {
    // Better Auth's client turns ISO strings into Date objects; sorting used
    // to throw on them and the list disappeared after un-starring.
    diary = [
      person(1, "Ana S.", { starred: true, createdAt: new Date() as unknown as string }),
      person(5, "Carla M.", { createdAt: new Date(0) as unknown as string }),
    ];
    await renderMobile(<DiaryScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "diaryUnfavourite, Ana S." }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/me/diary/1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ starred: false }) }),
      ),
    );
    expect(await screen.findByRole("button", { name: "diaryFavourite, Ana S." })).toBeTruthy();
    expect(screen.getByText("Carla M.")).toBeTruthy();
  });

  it("removes only through the explicit menu action", async () => {
    diary = [person(1, "Ana S.", { starred: true })];
    jest.spyOn(Alert, "alert").mockImplementation((_title, _body, buttons) => {
      buttons?.find((button) => button.style === "destructive")?.onPress?.();
    });
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    const menu = menuWith("remove");
    expect(menu.actions.map((action) => action.title)).toEqual([
      "diaryNote",
      "diaryRemoveFromDiary",
    ]);
    await act(() => menu.onPressAction({ nativeEvent: { event: "remove" } }));
    await waitFor(() => expect(screen.queryByText("Ana S.")).toBeNull());
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/me/diary/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("opens a saved person's profile from anywhere on the row", async () => {
    await renderMobile(<DiaryScreen />);
    await fireEvent.press(
      await screen.findByRole("button", { name: "Ana S., Builds robots, Rover" }),
    );
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/people/[id]", params: { id: "101" } });
    expect(screen.queryByRole("button", { name: /^diaryUnavailablePerson/ })).toBeNull();
  });

  it("searches saved cards locally, ignoring accents and case", async () => {
    diary = [person(1, "José P."), person(2, "Bea R.", { note: "Met at the robotics stand" })];
    await renderMobile(<DiaryScreen />);
    await screen.findByText("José P.");
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "jose");
    expect(screen.getByText("José P.")).toBeTruthy();
    expect(screen.queryByText("Bea R.")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "ROBOTICS STAND");
    expect(screen.getByText("Bea R.")).toBeTruthy();
    expect(screen.queryByText("José P.")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "nobody");
    expect(screen.getByText("scannerNoResults")).toBeTruthy();
    expect(calls("/api/directory")).toHaveLength(0);
  });

  it("filters to favourites", async () => {
    diary = [person(1, "Ana S.", { starred: true }), person(2, "Bea R.")];
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Bea R.");
    await fireEvent.press(screen.getByLabelText("diaryShowFavourites"));
    expect(screen.getByText("Ana S.")).toBeTruthy();
    expect(screen.queryByText("Bea R.")).toBeNull();
  });

  it("hides the directory scope without directory:read", async () => {
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    expect(screen.queryByRole("tab", { name: "diaryDirectoryTab" })).toBeNull();
  });

  it("lets a directory reader browse, search and save; saved people get the star", async () => {
    mockCapabilities = ["directory:read"];
    const carla = {
      userId: 300,
      displayName: "Carla M.",
      photoUrl: null,
      headline: "Data",
      bio: null,
      locationNote: null,
      socials: [],
      cvUrl: null,
      project: null,
      challenges: [],
    };
    jest.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === "/api/me/diary") return { items: diary };
      if (path === "/api/me/diary/sponsors") return collection;
      if (path.startsWith("/api/directory?")) return { items: [carla], nextCursor: null };
      if (path === "/api/me/diary/people") {
        return person(9, "Carla M.", {
          person: { ...person(9, "Carla M.").person!, userId: 300 },
        });
      }
      return undefined;
    });
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    await fireEvent.press(screen.getByRole("tab", { name: "diaryDirectoryTab" }));
    expect(await screen.findByText("Carla M.")).toBeTruthy();
    // Not saved yet: Save, and no favourite or remove.
    expect(screen.queryByRole("button", { name: /diaryFavourite, Carla/ })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "car");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/directory?limit=30&q=car"));
    await fireEvent.press(screen.getByRole("button", { name: "directorySave, Carla M." }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/me/diary/people",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ userId: 300 }) }),
      ),
    );
    expect(await screen.findByRole("button", { name: "diaryFavourite, Carla M." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "directorySave, Carla M." })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Carla M., Data" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/people/[id]", params: { id: "300" } });
  });
});

describe("Companies", () => {
  it("shows the album with progress, collected badges and locked ones", async () => {
    mockParams = { view: "companies" };
    await renderMobile(<DiaryScreen />);
    expect(await screen.findByLabelText("diaryCompaniesProgress:1/2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acme" })).toBeTruthy();
    // A company still to collect is named but not openable.
    expect(screen.getByLabelText("diaryCompanyLocked:Zeta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zeta" })).toBeNull();
  });

  it("opens a company sheet and favourites it without a person layout", async () => {
    mockParams = { view: "companies" };
    await renderMobile(<DiaryScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Acme" }));
    expect(await screen.findByText("Acme description")).toBeTruthy();
    expect(screen.getByText("Vision")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "diaryFavourite" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/me/diary/3",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ starred: true }) }),
      ),
    );
    expect(await screen.findByRole("button", { name: "diaryUnfavourite" })).toBeTruthy();
  });

  it("switches to Companies and reloads the album after a stand scan", async () => {
    scanResult = sponsorEntry;
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    await fireEvent.press(screen.getByRole("button", { name: "diaryScanNfc" }));
    collection = {
      ...collection,
      collected: 2,
      items: [company(9, "Acme", 3), company(10, "Zeta", 7)],
    };
    await act(async () => {
      mockNfc?.onValue("04A1B2C3D4E5F6");
      mockNfc?.onClose();
    });
    expect(await screen.findByLabelText("diaryCompaniesProgress:2/2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zeta" })).toBeTruthy();
  });
});
