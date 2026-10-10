import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { PersonProfileScreen } from "@/components/person-profile-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import type { DirectoryEntry } from "@/lib/directory";
import { renderMobile } from "./render";

let mockId = "101";
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: mockId }),
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true }),
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
  project: { kind: "project", id: 1, name: "Rover" },
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
    project: null,
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
    if (path === "/api/me/diary/people") return entry;
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
  await fireEvent.press(screen.getByRole("link", { name: "GitHub, github.com/ana" }));
  expect(open).toHaveBeenCalledWith("https://github.com/ana");
});

it("downloads the CV with the session before sharing it", async () => {
  await renderMobile(<PersonProfileScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "directoryCv" }));
  await waitFor(() => expect(mockShare).toHaveBeenCalled());
  expect(mockDownload).toHaveBeenCalledWith(
    "https://api.test/api/directory/101/cv",
    expect.anything(),
    expect.objectContaining({ headers: { Cookie: "session=1" } }),
  );
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

it("offers to save a person who is not in the diary yet", async () => {
  diary = [];
  await renderMobile(<PersonProfileScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "directorySave" }));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/me/diary/people",
      expect.objectContaining({ body: JSON.stringify({ userId: 101 }) }),
    ),
  );
  expect(await screen.findByRole("button", { name: "diaryFavourite" })).toBeTruthy();
});

it("shows one unavailable state for a hidden or unreadable profile", async () => {
  personResult = new ApiError("Person not found", 404);
  await renderMobile(<PersonProfileScreen />);
  expect(await screen.findByText("directoryPersonNotFound")).toBeTruthy();
});
