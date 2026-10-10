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
const mockSetOptions = jest.fn();
// Stable, as the real navigation object is: the header effect depends on it.
const mockNavigation = { setOptions: (options: unknown) => mockSetOptions(options) };
let mockParams: { view?: string; collect?: string } = {};
const mockSetParams = jest.fn();
jest.mock("expo-router", () => ({
  useScrollToTop: () => {},
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
  useNavigation: () => mockNavigation,
  useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
jest.mock("expo-router/stack", () => {
  const { Pressable } = require("react-native");
  const Toolbar = Object.assign(({ children }: { children?: unknown }) => children ?? null, {
    View: ({ children }: { children?: unknown }) => children ?? null,
    Button: ({
      accessibilityLabel,
      selected,
      onPress,
    }: {
      accessibilityLabel: string;
      selected?: boolean;
      onPress: () => void;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected }}
        onPress={onPress}
      />
    ),
  });
  return { __esModule: true, default: { Screen: () => null, Toolbar } };
});
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
// One stable `t`, as the real hook returns: the header effect depends on it.
const mockLocale = {
  language: "en",
  t: (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join("/")}` : key,
};
jest.mock("@/lib/i18n", () => ({ useLocale: () => mockLocale }));
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
let mockGlass = false;
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => mockGlass,
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
      projects: [{ kind: "project", id: 1, name: "Rover" }],
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
  mockGlass = false;
  mockParams = {};
  mockPush.mockReset();
  mockSetOptions.mockReset();
  mockSetOptions.mockImplementation((options: NativeOptions) => mockOnOptions?.(options));
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

type NativeOptions = {
  headerRight?: () => React.ReactElement;
  headerSearchBarOptions?: { onChangeText: (e: { nativeEvent: { text: string } }) => void };
};

/** The options the last `setOptions` call left in place. */
function nativeOptions(): NativeOptions {
  return (mockSetOptions.mock.calls.at(-1)?.[0] ?? {}) as NativeOptions;
}

function nativeSearch() {
  return nativeOptions().headerSearchBarOptions;
}

let mockOnOptions: ((options: NativeOptions) => void) | null = null;

/** The screen plus its native header's bar items, as the navigator renders them. */
function WithNativeHeader() {
  const { useLayoutEffect, useState } = require("react");
  const [options, setOptions] = useState({} as NativeOptions);
  useLayoutEffect(() => {
    mockOnOptions = setOptions;
    setOptions(nativeOptions());
    return () => {
      mockOnOptions = null;
    };
  }, []);
  return (
    <>
      <DiaryScreen />
      {options.headerRight?.()}
    </>
  );
}

describe("People", () => {
  it("lists saved people only; stands live in Companies", async () => {
    await renderMobile(<DiaryScreen />);
    expect(await screen.findByText("Ana S.")).toBeTruthy();
    expect(screen.getByText("diaryUnavailablePerson")).toBeTruthy();
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.getByRole("button", { name: "diaryUnfavourite, Ana S." })).toBeTruthy();
    // A hidden profile keeps its menu but cannot be favourited.
    expect(
      screen.queryByRole("button", { name: /^diary(Un)?favourite, diaryUnavailablePerson/ }),
    ).toBeNull();
    expect(screen.getByLabelText("diaryEntryOptions, diaryUnavailablePerson")).toBeTruthy();
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
    // The diary accepts badges and stand tags alike, so the entry is titled "Enter code".
    await fireEvent.changeText(screen.getByLabelText("personEnterBadgeCode"), "  STAND-CODE  ");
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
    // Android and earlier iOS: the header's search button opens the field.
    await fireEvent.press(screen.getByRole("button", { name: "scheduleSearch" }));
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "jose");
    expect(screen.getByText("José P.")).toBeTruthy();
    expect(screen.queryByText("Bea R.")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "ROBOTICS STAND");
    expect(screen.getByText("Bea R.")).toBeTruthy();
    expect(screen.queryByText("José P.")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "nobody");
    expect(screen.getByText("scannerNoResults")).toBeTruthy();
    expect(mockSetOptions).toHaveBeenCalledWith({ headerShown: false });
  });

  it("uses the native header search and a favourites toolbar button on iOS 26", async () => {
    mockGlass = true;
    diary = [person(1, "José P.", { starred: true }), person(2, "Bea R.")];
    await renderMobile(<WithNativeHeader />);
    await screen.findByText("José P.");
    // The title is a leading bar item on the bar row, not a large title below it.
    expect(mockSetOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerLargeTitle: false, title: "" }),
    );
    expect(screen.getByRole("header", { name: "tabDiary" })).toBeTruthy();
    await act(async () => nativeSearch()?.onChangeText({ nativeEvent: { text: "bea" } }));
    expect(screen.getByText("Bea R.")).toBeTruthy();
    expect(screen.queryByText("José P.")).toBeNull();
    await act(async () => nativeSearch()?.onChangeText({ nativeEvent: { text: "" } }));
    await fireEvent.press(screen.getByLabelText("diaryShowFavourites"));
    expect(screen.getByText("José P.")).toBeTruthy();
    expect(screen.queryByText("Bea R.")).toBeNull();
    // Scanning stays the shared pill in the content.
    expect(screen.getByRole("button", { name: "diaryScanNfc" })).toBeTruthy();
    // Companies has no search: the native bar and the filter go away.
    await fireEvent.press(screen.getByRole("tab", { name: "diaryCompaniesTab" }));
    expect(nativeSearch()).toBeUndefined();
    expect(screen.queryByLabelText("diaryShowFavourites")).toBeNull();
  });

  it("filters to favourites", async () => {
    diary = [person(1, "Ana S.", { starred: true }), person(2, "Bea R.")];
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Bea R.");
    await fireEvent.press(screen.getByLabelText("diaryShowFavourites"));
    expect(screen.getByText("Ana S.")).toBeTruthy();
    expect(screen.queryByText("Bea R.")).toBeNull();
  });

  it("offers only People | Companies, with no directory to browse", async () => {
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    expect(screen.getAllByRole("tab").map((tab) => tab.props.accessibilityLabel)).toEqual([
      "diaryPeopleTab",
      "diaryCompaniesTab",
    ]);
    expect(
      jest.mocked(apiFetch).mock.calls.some(([path]) => String(path).startsWith("/api/directory")),
    ).toBe(false);
  });

  it("hides search and the favourites filter on Companies", async () => {
    await renderMobile(<DiaryScreen />);
    await screen.findByText("Ana S.");
    await fireEvent.press(screen.getByRole("button", { name: "scheduleSearch" }));
    await fireEvent.changeText(screen.getByLabelText("scheduleSearch"), "nobody");
    await fireEvent.press(screen.getByRole("tab", { name: "diaryCompaniesTab" }));
    expect(screen.queryByLabelText("scheduleSearch")).toBeNull();
    expect(screen.queryByLabelText("diaryShowFavourites")).toBeNull();
    // Back on People the query is gone, not silently still filtering.
    await fireEvent.press(screen.getByRole("tab", { name: "diaryPeopleTab" }));
    expect(screen.getByText("Ana S.")).toBeTruthy();
  });
});

describe("Companies", () => {
  it("collects a company-tag link once, on the Companies album (#935)", async () => {
    scanResult = sponsorEntry;
    mockParams = { view: "companies", collect: "04A1B2C3D4E5F6" };
    await renderMobile(<DiaryScreen />);
    await waitFor(() => expect(calls("/api/me/diary/scan")).toHaveLength(1));
    expect(JSON.parse(String(calls("/api/me/diary/scan")[0]?.[1]?.body))).toEqual({
      code: "04A1B2C3D4E5F6",
    });
    // The link is consumed so returning to the Diary does not collect again.
    expect(mockSetParams).toHaveBeenCalledWith({ collect: undefined });
    expect(await screen.findByText("Acme")).toBeTruthy();
    expect(calls("/api/me/diary/scan")).toHaveLength(1);
  });

  it("shows the album with progress, collected badges and locked ones", async () => {
    mockParams = { view: "companies" };
    await renderMobile(<DiaryScreen />);
    expect(await screen.findByLabelText("diaryCompaniesProgress:1/2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acme" })).toBeTruthy();
    // A company still to collect is named but not openable.
    expect(screen.getByLabelText("diaryCompanyLocked:Zeta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zeta" })).toBeNull();
  });

  it("keeps the API's priority order and shows only logo and name for locked companies", async () => {
    collection = {
      total: 3,
      collected: 1,
      items: [company(11, "Zeta", null), company(9, "Acme", 3), company(12, "Beta", null)],
    };
    mockParams = { view: "companies" };
    await renderMobile(<DiaryScreen />);
    await screen.findByLabelText("diaryCompaniesProgress:1/3");
    const names = screen
      .getAllByText(/^(Acme|Beta|Zeta)$/)
      .map((node) => String(node.props.children));
    expect(names).toEqual(["Zeta", "Acme", "Beta"]);
    // Nothing else of a locked company reaches the screen.
    expect(screen.queryByText("Zeta description")).toBeNull();
    expect(screen.queryByText("Vision")).toBeNull();
    expect(screen.queryByRole("button", { name: "Beta" })).toBeNull();
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
