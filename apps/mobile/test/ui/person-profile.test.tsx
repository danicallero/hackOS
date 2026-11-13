import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { PersonProfileScreen } from "@/components/person-profile-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import type { DirectoryEntry } from "@/lib/directory";
import { renderMobile } from "./render";

let mockId = "101";
const mockBack = jest.fn();
const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: mockId }),
  Link: require("./mock-link").makeLink((href: unknown) => mockRouterPush(href)),
  useRouter: () => ({ back: mockBack, canGoBack: () => true, push: mockRouterPush }),
}));
jest.mock("expo-router/stack", () => ({ __esModule: true, default: { Screen: () => null } }));
const mockDownload: jest.Mock = jest.fn();
jest.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class {
    static downloadFileAsync(...args: unknown[]): unknown {
      return mockDownload(...args);
    }
    exists = false;
    delete() {}
  },
}));
const mockShare = jest.fn();
jest.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
  getCurrentSessionCookie: () => "session=1",
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
let mockTint: string | null = null;
jest.mock("@/lib/image-tint", () => ({
  prefetchImageTint: jest.fn(),
  useImageTint: (uri: string | null | undefined) => ({
    color: uri ? mockTint : null,
    settled: !uri || mockTint !== null,
    fromCache: true,
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));

const profile: DirectoryEntry = {
  userId: 101,
  displayName: "Ana Souto",
  photoUrl: "/api/users/101/photo?v=abc",
  headline: "Robotics engineer",
  bio: "I build rovers.",
  locationNote: "Table 12",
  socials: [
    { kind: "github", url: "https://github.com/ana" },
    { kind: "website", url: "https://ana.dev/" },
  ],
  cvUrl: "/api/directory/101/cv",
  projects: [{ kind: "project", id: 1, name: "Rover" }],
  challenges: [{ id: 2, name: "Robotics" }],
};

const entry: DiaryEntry = {
  id: 7,
  kind: "person",
  starred: false,
  note: "Ask about the arm",
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
  person: {
    userId: 101,
    displayName: "Ana Souto",
    photoUrl: null,
    headline: null,
    locationNote: null,
    projects: [],
    challenges: [],
  },
  sponsor: null,
};

let personResult: DirectoryEntry | Error;
let diary: DiaryEntry[];

beforeEach(() => {
  mockId = "101";
  personResult = profile;
  mockTint = null;
  diary = [entry];
  mockDownload.mockReset().mockResolvedValue({ uri: "file:///cache/ana-souto-cv.pdf" });
  mockShare.mockReset().mockResolvedValue(undefined);
  jest.mocked(apiFetch).mockReset();
  jest.mocked(apiFetch).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/directory/101") {
      if (personResult instanceof Error) throw personResult;
      return personResult;
    }
    if (path === "/api/me/diary") return { items: diary };
    if (init?.method === "PATCH") return { ...entry, ...JSON.parse(String(init.body)) };
    return undefined;
  });
});

it("shows the whole profile with the saved note", async () => {
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByText("Ana Souto")).toBeTruthy();
  for (const text of [
    "Robotics engineer",
    "I build rovers.",
    "Table 12",
    "Rover",
    "Robotics",
    "Ask about the arm",
    "GitHub",
    "directoryWebsite",
  ]) {
    expect(screen.getByText(text)).toBeTruthy();
  }
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  // A note exists, so its section shows it and the tile edits it.
  expect(screen.getByRole("button", { name: "diaryEditNote" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "diaryNote" })).toBeNull();
  await fireEvent.press(screen.getByRole("link", { name: "GitHub, github.com/ana" }));
  expect(open).toHaveBeenCalledWith("https://github.com/ana");
});

it("tints the hero from the photo's colour (H48)", async () => {
  mockTint = "#3366cc";
  await renderMobile(<PersonProfileScreen />);
  await screen.findByText("Ana Souto");
  expect(screen.getByTestId("person-hero").props.style.experimental_backgroundImage).toContain(
    "rgba(51,102,204,0.8)",
  );
});

it("waits for the photo's colour, and is blue without a photo (H48)", async () => {
  await renderMobile(<PersonProfileScreen />);
  await screen.findByText("Ana Souto");
  expect(screen.queryByTestId("person-hero")).toBeNull();
  mockTint = "#3366cc";
  personResult = { ...profile, photoUrl: null };
  await renderMobile(<PersonProfileScreen />);
  expect(screen.getByTestId("person-hero").props.style.experimental_backgroundImage).toContain(
    "rgba(0,122,255,0.8)",
  );
});

it("lists every company the person belongs to, each opening its page (H44)", async () => {
  personResult = {
    ...profile,
    enterprises: [
      { id: 4, name: "Acme", logoUrl: null },
      { id: 9, name: "Globex", logoUrl: null },
    ],
  };
  await renderMobile(<PersonProfileScreen />);
  await screen.findByText("Ana Souto");
  await fireEvent.press(screen.getByRole("button", { name: "Globex" }));
  expect(screen.getByRole("button", { name: "Acme" })).toBeTruthy();
  expect(mockRouterPush).toHaveBeenCalledWith("/companies/9");
});

it("offers Report on another person's profile (H18)", async () => {
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByRole("button", { name: "reportContent" })).toBeTruthy();
});

it("keeps Report available when the diary read fails (H18)", async () => {
  jest.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path === "/api/directory/101") return personResult;
    throw new Error("offline diary");
  });
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByRole("button", { name: "reportContent" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /diaryRemoveFromDiary/ })).toBeNull();
});

async function layoutProfile(insets?: { top: number }) {
  await renderMobile(<PersonProfileScreen />, { insets });
  await screen.findByText("Ana Souto");
  const scroll = screen.getByTestId("person-profile");
  let host = scroll.parent;
  while (host && !host.props.onLayout) host = host.parent;
  await fireEvent(host as NonNullable<typeof host>, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } },
  });
  return screen.getByTestId("person-profile").props.contentContainerStyle.minHeight;
}

it("keeps a short profile scrollable past the collapsed avatar (#935)", async () => {
  // A Dynamic Island iPhone, where the avatar morphs into the island.
  const minHeight = await layoutProfile({ top: 59 });
  // The viewport plus enough scroll for the 120 pt morph past the true top.
  expect(minHeight).toBeGreaterThanOrEqual(852 + 120 - 59);
});

it("keeps a short notch profile scrollable through the full merge (H7)", async () => {
  expect(await layoutProfile({ top: 47 })).toBeGreaterThanOrEqual(852 + 120 - 47);
});

it("does not pad a short profile without a camera cutout to collapse into (#935)", async () => {
  expect(await layoutProfile({ top: 20 })).toBeUndefined();
});

it("lists every project the person is in (#935)", async () => {
  personResult = {
    ...profile,
    projects: [
      { kind: "project", id: 1, name: "Rover" },
      { kind: "project", id: 3, name: "Lander" },
      { kind: "project", id: 4, name: "Side quest" },
    ],
  };
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByText("Rover")).toBeTruthy();
  expect(screen.getByText("Lander")).toBeTruthy();
  expect(screen.getByText("Side quest")).toBeTruthy();
  expect(screen.getByText("directoryProjects")).toBeTruthy();
});

it("opens a listed project and a challenge gallery from the profile (H18)", async () => {
  personResult = {
    ...profile,
    projects: [{ kind: "project", id: 3, name: "Lander" }],
    challenges: [{ id: 9, name: "Space" }],
  };
  await renderMobile(<PersonProfileScreen />);
  await fireEvent.press(await screen.findByRole("link", { name: /Lander/ }));
  expect(mockRouterPush).toHaveBeenCalledWith({
    pathname: "/projects/[id]",
    params: { id: "3", gallery: "1" },
  });
  await fireEvent.press(screen.getByRole("link", { name: /Space/ }));
  expect(mockRouterPush).toHaveBeenCalledWith({
    pathname: "/projects/gallery",
    params: { challengeId: "9" },
  });
});

it("opens the CV in the in-app viewer after downloading it with the session", async () => {
  mockDownload.mockResolvedValue({ uri: "file:///cache/ana-souto-cv.pdf" });
  await renderMobile(<PersonProfileScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "directoryCv" }));
  const pdf = await screen.findByTestId("cv-viewer-pdf");
  expect(pdf.props.source).toEqual({ uri: "file:///cache/ana-souto-cv.pdf" });
  expect(mockDownload).toHaveBeenCalledWith(
    "https://api.test/api/directory/101/cv",
    expect.anything(),
    expect.objectContaining({ headers: { Cookie: "session=1" } }),
  );
  // Nothing is shared until the reader asks for the file.
  expect(mockShare).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "directoryCvShare" }));
  await waitFor(() =>
    expect(mockShare).toHaveBeenCalledWith(
      "file:///cache/ana-souto-cv.pdf",
      expect.objectContaining({ mimeType: "application/pdf" }),
    ),
  );
});

it("shows the not-available state when the CV is gone", async () => {
  mockDownload.mockRejectedValue(new Error("download failed"));
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({ status: 404 } as Response);
  await renderMobile(<PersonProfileScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "directoryCv" }));
  expect(await screen.findByText("directoryPersonNotFound")).toBeTruthy();
  expect(screen.queryByTestId("cv-viewer-pdf")).toBeNull();
  expect(screen.queryByRole("button", { name: "directoryCvShare" })).toBeNull();
  expect(fetchSpy).toHaveBeenCalledWith(
    "https://api.test/api/directory/101/cv",
    expect.objectContaining({ method: "HEAD" }),
  );
  fetchSpy.mockRestore();
});

it("offers a retry when the CV download fails for another reason", async () => {
  mockDownload.mockRejectedValueOnce(new Error("offline"));
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  await renderMobile(<PersonProfileScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "directoryCv" }));
  expect(await screen.findByText("directoryCvError")).toBeTruthy();
  mockDownload.mockResolvedValue({ uri: "file:///cache/ana-souto-cv.pdf" });
  await fireEvent.press(screen.getByRole("button", { name: "retry" }));
  expect(await screen.findByTestId("cv-viewer-pdf")).toBeTruthy();
  fetchSpy.mockRestore();
});

it("toggles the favourite of the saved entry", async () => {
  await renderMobile(<PersonProfileScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "diaryFavourite" }));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/me/diary/7",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ starred: true }) }),
    ),
  );
  expect(await screen.findByRole("button", { name: "diaryUnfavourite" })).toBeTruthy();
});

it("offers no Save: people get into the diary only by a scan", async () => {
  diary = [];
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByText("Ana Souto")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "directorySave" })).toBeNull();
  expect(screen.queryByRole("button", { name: "diaryFavourite" })).toBeNull();
});

it("goes back after removing the person from the diary", async () => {
  mockBack.mockReset();
  jest.spyOn(Alert, "alert").mockImplementation((_title, _body, buttons) => {
    buttons?.find((button) => button.style === "destructive")?.onPress?.();
  });
  await renderMobile(<PersonProfileScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "diaryRemoveFromDiary" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(apiFetch).toHaveBeenCalledWith(
    "/api/me/diary/7",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(jest.mocked(apiFetch).mock.calls.map(([path]) => path)).not.toContain(
    "/api/me/diary/people",
  );
});

it("shows one unavailable state for a hidden or unreadable profile", async () => {
  personResult = new ApiError("Person not found", 404);
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByText("directoryPersonNotFound")).toBeTruthy();
});

it("preserves the rendered profile after refresh fails, then retries without losing it", async () => {
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByText("Ana Souto")).toBeTruthy();
  personResult = new Error("offline");
  const scroll = screen.getByTestId("person-profile");
  await act(async () => {
    await scroll.props.refreshControl.props.onRefresh();
  });
  expect(await screen.findByText("requestError")).toBeTruthy();
  expect(screen.getByText("Ana Souto")).toBeTruthy();
  expect(screen.getByText("I build rovers.")).toBeTruthy();
  personResult = profile;
  await fireEvent.press(screen.getByRole("button", { name: "retry" }));
  await waitFor(() => expect(screen.queryByText("requestError")).toBeNull());
  expect(screen.getByText("Ana Souto")).toBeTruthy();
});
