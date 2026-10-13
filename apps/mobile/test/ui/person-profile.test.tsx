import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { PersonProfileScreen } from "@/components/person-profile-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import type { DirectoryEntry } from "@/lib/directory";
import { renderMobile } from "./render";

let mockId = "101";
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: mockId }),
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
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

it("does not pad a short profile without a camera cutout to collapse into (#935)", async () => {
  expect(await layoutProfile()).toBeUndefined();
});

it("lists every project the person is in (#935)", async () => {
  personResult = {
    ...profile,
    projects: [
      { kind: "project", id: 1, name: "Rover" },
      { kind: "project", id: 3, name: "Lander" },
    ],
  };
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByText("Rover\nLander")).toBeTruthy();
  expect(screen.getByText("directoryProjects")).toBeTruthy();
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
