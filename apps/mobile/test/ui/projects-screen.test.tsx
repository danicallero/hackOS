import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, View } from "react-native";

let mockParams: Record<string, string> = { id: "5" };
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockSetOptions = jest.fn();
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#171717" }) }));
jest.mock("@/components/header-back-button", () => ({ EntryBackToolbar: () => null }));
jest.mock("expo-router", () => ({
  useScrollToTop: jest.fn(),
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  useFocusEffect: (callback: () => undefined | (() => void)) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(callback, [callback]);
  },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ addListener: jest.fn(() => () => {}), setOptions: mockSetOptions }),
}));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { id: 11 } }) }));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
  getCurrentSessionCookie: () => "session=1",
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(message: string, status: number, _code?: string, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));
jest.mock("expo-router/stack", () => {
  const Toolbar = Object.assign(({ children }: { children?: unknown }) => children ?? null, {
    Button: () => null,
    Badge: () => null,
    Spacer: () => null,
  });
  return { __esModule: true, default: { Screen: () => null, Toolbar } };
});
jest.mock("@/components/glass-view", () => ({
  isRealLiquidGlassAvailable: () => false,
  GlassView: ({ children }: { children?: unknown }) => children ?? null,
}));
jest.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: jest.fn() }),
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: (uri: string) => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        saveAsync: async () => ({ uri: uri.replace(/\.\w+$/, ".jpg") }),
      }),
    }),
  },
}));
const mockFileBytes = jest.fn(async () => new Uint8Array([1, 2, 3]));
jest.mock("expo-file-system", () => ({
  File: class extends Blob {
    uri: string;
    name = "a.png";
    type = "image/png";
    bytes = mockFileBytes;
    constructor(uri: string) {
      super(["png"], { type: "image/png" });
      this.uri = uri;
    }
  },
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));

import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ChallengeDetailScreen } from "@/components/challenge-detail";
import { DynamicForm } from "@/components/dynamic-form";
import { InviteTeammatesScreen } from "@/components/invite-teammates-screen";
import { MyProjectsScreen } from "@/components/my-projects-screen";
import { NewProjectScreen } from "@/components/new-project-screen";
import { ProjectChallengesScreen } from "@/components/project-challenges-screen";
import { ProjectEditor, ProjectReadView } from "@/components/project-detail-screen";
import { clearGallerySnapshots, ProjectGalleryScreen } from "@/components/project-gallery-screen";
import { ProjectInvitesScreen } from "@/components/project-invites-screen";
import { ApiError, apiFetch } from "@/lib/api";
import type { NativeProject } from "@/lib/projects";
import { renderMobile } from "./render";

const mockApi = apiFetch as jest.Mock;
const project: NativeProject = {
  id: 5,
  name: "Rover",
  submissionStatus: "draft",
  responses: {},
  revision: 0,
  template: [],
  sections: [],
  members: [{ userId: 7, name: "Ana", status: "active", photoUrl: null }],
  challenges: [],
  presentations: [],
};
beforeEach(() => {
  clearGallerySnapshots();
  mockParams = { id: "5" };
  mockApi.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockSetOptions.mockReset();
});
it("hides creation when server policy denies it and links to the invitation inbox (H19)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/projects")
      return Promise.resolve({ projects: [project], canCreate: false });
    if (path === "/api/me/projects/invites")
      return Promise.resolve({
        invites: [{ id: 8, projectId: 8, name: "Lander", invitedBy: "Leo" }],
      });
    return Promise.resolve([]);
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("Rover")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "createProject" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "projectInvitations, 1" }));
  expect(mockPush).toHaveBeenCalledWith("/queue/invites");
});

it("accepts an invitation from the inbox and removes its row at once (H19)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/projects/invites")
      return Promise.resolve({
        invites: [{ id: 8, projectId: 8, name: "Lander", invitedBy: "Leo" }],
      });
    return Promise.resolve({});
  });
  await renderMobile(<ProjectInvitesScreen />);
  expect(await screen.findByText("projectInvitedBy")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "projectAcceptShort" }));
  expect(screen.queryByText("Lander")).toBeNull();
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      "/api/me/projects/8/invites/accept",
      expect.objectContaining({ method: "POST" }),
    ),
  );
});

it("shows the server reason when an invitation cannot be accepted and restores the list (H19)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/projects/8/invites/accept")
      return Promise.reject(new ApiError("full", 409));
    if (path === "/api/me/projects/invites")
      return Promise.resolve({ invites: [{ id: 8, projectId: 8, name: "Lander" }] });
    return Promise.resolve({});
  });
  await renderMobile(<ProjectInvitesScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "projectAcceptShort" }));
  expect(await screen.findByText("requestError")).toBeTruthy();
  expect(await screen.findByText("Lander")).toBeTruthy();
});

it("shows an empty inbox (H19)", async () => {
  mockApi.mockResolvedValue({ invites: [] });
  await renderMobile(<ProjectInvitesScreen />);
  expect(await screen.findByText("projectNoInvites")).toBeTruthy();
});

it("invites the user to create a first project and opens the sheet (H19)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/projects") return Promise.resolve({ projects: [], canCreate: true });
    if (path === "/api/me/projects/invites") return Promise.resolve({ invites: [] });
    return Promise.resolve([]);
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("projectNoProjects")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "createProject" }));
  expect(mockPush).toHaveBeenCalledWith("/queue/new");
});

it("explains a closed phase on the empty list instead of offering creation (H17)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/projects") return Promise.resolve({ projects: [], canCreate: false });
    if (path === "/api/me/projects/invites") return Promise.resolve({ invites: [] });
    return Promise.resolve([]);
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("projectLocked")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "createProject" })).toBeNull();
});

it("creates a project from the sheet: Create stays disabled until the name is valid (H19)", async () => {
  mockApi.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/api/me/projects" && init?.method === "POST") return Promise.resolve({ id: 12 });
    if (path === "/api/me/projects") return Promise.resolve({ projects: [], canCreate: true });
    return Promise.resolve({});
  });
  await renderMobile(<NewProjectScreen />);
  const create = () => mockSetOptions.mock.calls.at(-1)?.[0].headerRight();
  expect(create().props.disabled).toBe(true);
  expect(screen.getByLabelText("projectName").props.autoFocus).toBe(true);
  await fireEvent.changeText(screen.getByLabelText("projectName"), "  ");
  expect(create().props.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText("projectName"), "Rover");
  expect(create().props.disabled).toBe(false);
  await act(async () => {
    create().props.onPress();
  });
  expect(mockApi).toHaveBeenCalledWith(
    "/api/me/projects",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Rover" }) }),
  );
  expect(mockReplace).toHaveBeenCalledWith("/projects/12");
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

it("keeps the sheet open and shows the reason when creation fails (H19)", async () => {
  mockApi.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/api/me/projects" && init?.method === "POST")
      return Promise.reject(new ApiError("closed", 403));
    return Promise.resolve({ projects: [], canCreate: true });
  });
  await renderMobile(<NewProjectScreen />);
  await fireEvent.changeText(screen.getByLabelText("projectName"), "Rover");
  await act(async () => {
    mockSetOptions.mock.calls.at(-1)?.[0].headerRight().props.onPress();
  });
  expect(await screen.findByText("apiErrorForbidden")).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
});

it("refuses creation in a closed phase (H17)", async () => {
  mockApi.mockResolvedValue({ projects: [], canCreate: false });
  await renderMobile(<NewProjectScreen />);
  expect(await screen.findByText("projectLocked")).toBeTruthy();
  expect(screen.getByLabelText("projectName").props.editable).toBe(false);
});

it("shows several projects as grouped rows with their queue brief (R006, H21)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/projects")
      return Promise.resolve({
        projects: [project, { ...project, id: 6, name: "Lander", submissionStatus: "submitted" }],
        canCreate: true,
      });
    if (path === "/api/me/projects/invites") return Promise.resolve({ invites: [] });
    if (path === "/api/queue/me")
      return Promise.resolve([
        {
          entryId: 1,
          repoId: 5,
          challengeTitle: "Space",
          status: "waiting",
          position: 3,
          etaMinutes: 12,
        },
        {
          entryId: 2,
          repoId: 5,
          challengeTitle: "Health",
          status: "called",
          position: null,
          etaMinutes: null,
        },
      ]);
    return Promise.resolve([]);
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("Space · queuePosition · queueEtaMinutes")).toBeTruthy();
  expect(screen.getByText("Health · queueStatusCalled")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: /^Lander/ }));
  expect(mockPush).toHaveBeenCalledWith("/projects/6");
});

it("does not infer member photos or unpublished winners from directory data (H18/H60)", async () => {
  await renderMobile(<ProjectReadView project={project} />);
  expect(screen.getByText("Ana")).toBeTruthy();
  expect(screen.queryByRole("image")).toBeNull();
  expect(screen.queryByText(/projectWinner/)).toBeNull();
});
it("reports a gallery project from a native sheet, never the team's own (H18)", async () => {
  const sheet = jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementation((_options, done) => done(1));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockApi.mockResolvedValue({ id: 1, status: "open" });
  await renderMobile(<ProjectReadView project={project} />);
  await fireEvent.press(screen.getByRole("button", { name: "reportContent" }));
  expect(sheet).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      "/api/reports",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectId: 5, reason: "harassment" }),
      }),
    ),
  );
  await waitFor(() => expect(alert).toHaveBeenCalledWith("reportSent", "reportSentBody"));
  sheet.mockRestore();
  alert.mockRestore();
});
it("offers no report on the team's own project (H18)", async () => {
  await renderMobile(<ProjectReadView project={{ ...project, isMember: true }} />);
  expect(screen.queryByRole("button", { name: "reportContent" })).toBeNull();
});
it("renders published winners only from the approved projection (H60)", async () => {
  await renderMobile(
    <ProjectReadView
      project={{ ...project, winners: [{ challengeId: 9, rank: 1, challengeTitle: "Space" }] }}
    />,
  );
  expect(screen.getByText("projectWinner")).toBeTruthy();
  expect(screen.getByText("Space")).toBeTruthy();
});
it("edits shared organizer-defined questions without enforcing required fields on draft (H16/H20)", async () => {
  const change = jest.fn();
  await renderMobile(
    <DynamicForm
      template={[
        {
          key: "story",
          kind: "textarea",
          required: true,
          label: { en: "Story", es: "Historia", gl: "Historia" },
        },
      ]}
      sections={[]}
      responses={{}}
      onChange={change}
    />,
  );
  await fireEvent.changeText(screen.getByLabelText("Story"), "Built a rover");
  expect(change).toHaveBeenCalledWith("story", "Built a rover");
});

it("locks participant edits and offers no submission when the server closes editing (H17/H20)", async () => {
  mockApi.mockResolvedValue([]);
  await renderMobile(
    <ProjectEditor reload={async () => {}} project={{ ...project, canEdit: false }} />,
  );
  expect(await screen.findByText("projectLocked")).toBeTruthy();
  expect(screen.getByLabelText("projectName").props.editable).toBe(false);
  expect(screen.queryByRole("button", { name: "projectSubmit" })).toBeNull();
});

it("labels a submitted project's action Resubmit and shows the server deadline (H20)", async () => {
  mockApi.mockResolvedValue([]);
  await renderMobile(
    <ProjectEditor
      reload={async () => {}}
      project={{
        ...project,
        canEdit: true,
        canSubmit: true,
        submissionStatus: "submitted",
        submissionsCloseAt: "2026-10-18T10:00:00Z",
      }}
    />,
  );
  expect(await screen.findByRole("button", { name: "projectResubmit" })).toBeTruthy();
  expect(screen.getByText(/projectSaved · projectDeadline: /)).toBeTruthy();
});

it("offers to withdraw a frozen submitted project instead of resubmitting (H20)", async () => {
  mockApi.mockResolvedValue([]);
  await renderMobile(
    <ProjectEditor
      reload={async () => {}}
      project={{
        ...project,
        canEdit: false,
        canSubmit: false,
        canWithdraw: true,
        submissionStatus: "submitted",
      }}
    />,
  );
  expect(await screen.findByRole("button", { name: "projectWithdraw" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "projectResubmit" })).toBeNull();
});

const settle = (overrides: Record<string, unknown>) =>
  mockApi.mockImplementation((path: string) => {
    if (path in overrides) {
      const value = overrides[path];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (path === "/api/public/challenges") return Promise.resolve({ items: [] });
    return Promise.resolve({});
  });

it("offers no retry when the server denies the audience (H17)", async () => {
  settle({
    "/api/me/projects": new ApiError("forbidden", 403),
    "/api/me/projects/invites": new ApiError("forbidden", 403),
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("apiErrorForbidden")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "retry" })).toBeNull();
  expect(screen.queryByText("projectNoProjects")).toBeNull();
});

it("keeps projects visible when only the invitation read fails (H19)", async () => {
  settle({
    "/api/me/projects": { projects: [project], canCreate: false },
    "/api/me/projects/invites": new ApiError("boom", 500),
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("Rover")).toBeTruthy();
  expect(screen.getByText("apiErrorServer")).toBeTruthy();
});

it("uploads an Expo File part and explains a server size rejection (H16)", async () => {
  const append = jest.spyOn(FormData.prototype, "append");
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///a.png", name: "a.png", mimeType: "image/png", size: 10 }],
  });
  mockApi.mockImplementation((path: string) => {
    if (path.startsWith("/api/me/projects/5/uploads"))
      return Promise.reject(new ApiError("big", 413));
    return Promise.resolve([]);
  });
  await renderMobile(
    <ProjectEditor
      reload={async () => {}}
      project={{
        ...project,
        canEdit: true,
        template: [
          { key: "logo", kind: "file", label: { en: "Logo", es: "Logo", gl: "Logo" } },
        ] as NativeProject["template"],
      }}
    />,
  );
  await fireEvent.press(await screen.findByRole("button", { name: "projectUpload" }));
  expect(await screen.findByText("projectTooLarge")).toBeTruthy();
  expect(append).toHaveBeenCalledWith(
    "file",
    expect.objectContaining({ uri: "file:///a.png", bytes: mockFileBytes }),
    "a.png",
  );
  append.mockRestore();
});

it("opens the challenge picker from the editor and disables it when closed (H17/H21)", async () => {
  mockApi.mockResolvedValue({});
  await renderMobile(
    <ProjectEditor
      reload={async () => {}}
      project={{
        ...project,
        canEdit: true,
        challenges: [{ id: 2, title: "Health", mandatory: true }],
      }}
    />,
  );
  expect(await screen.findByText("Health")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "projectAddChallenge" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/projects/challenges",
    params: { id: "5" },
  });
  await renderMobile(
    <ProjectEditor reload={async () => {}} project={{ ...project, canEdit: false }} />,
  );
  expect(
    screen.getByRole("button", { name: "projectAddChallenge" }).props.accessibilityState.disabled,
  ).toBe(true);
});

const manyChallenges = Array.from({ length: 14 }, (_, index) => ({
  id: index + 1,
  title: `Challenge ${String(index + 1).padStart(2, "0")}`,
}));
const catalogue = {
  items: manyChallenges.map((item) => ({ id: item.id, title: { en: item.title } })),
};
const pickerApi = (
  selected: { id: number; title: string; mandatory?: boolean }[],
  canEdit = true,
) =>
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/public/challenges") return Promise.resolve(catalogue);
    if (path === "/api/me/projects/5")
      return Promise.resolve({ ...project, canEdit, challenges: selected });
    if (path.startsWith("/api/me/projects/5/challenges/")) return Promise.resolve({});
    return Promise.resolve({});
  });

it("pins mandatory challenges, locks them and lists every other challenge (H21)", async () => {
  pickerApi([{ id: 3, title: "Challenge 03", mandatory: true }]);
  await renderMobile(<ProjectChallengesScreen />);
  expect(await screen.findByText("projectRequired")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Challenge 03" }).props.accessibilityState.disabled,
  ).toBe(true);
  expect(screen.getAllByText(/^Challenge \d\d$/)).toHaveLength(14);
  await fireEvent.press(screen.getByRole("button", { name: "Challenge 03" }));
  expect(mockApi).not.toHaveBeenCalledWith("/api/me/projects/5/challenges/3", expect.anything());
});

it("selects a challenge optimistically and restores it when the server refuses (H21)", async () => {
  pickerApi([]);
  await renderMobile(<ProjectChallengesScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "Challenge 07" }));
  expect(mockApi).toHaveBeenCalledWith(
    "/api/me/projects/5/challenges/7",
    expect.objectContaining({ method: "PUT" }),
  );
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/projects/5/challenges/8")
      return Promise.reject(new ApiError("closed", 409));
    if (path === "/api/public/challenges") return Promise.resolve(catalogue);
    return Promise.resolve({ ...project, canEdit: true, challenges: [] });
  });
  await fireEvent.press(screen.getByRole("button", { name: "Challenge 08" }));
  expect(await screen.findByText("requestError")).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Challenge 08" }).props.accessibilityState.selected,
    ).toBe(false),
  );
});

it("locks the picker when the server closes editing (H17/H21)", async () => {
  pickerApi([], false);
  await renderMobile(<ProjectChallengesScreen />);
  const row = await screen.findByRole("button", { name: "Challenge 01" });
  expect(row.props.accessibilityState.disabled).toBe(true);
});

it("shows gallery winners only from the projection and no retry when denied (H18/H60)", async () => {
  settle({
    "/api/public/projects?page=1&pageSize=20&search=": {
      items: [
        { ...project, winners: [{ challengeId: 9, rank: 1, challengeTitle: "Space" }] },
        { ...project, id: 6, name: "Lander" },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    },
  });
  await renderMobile(<ProjectGalleryScreen />);
  expect(await screen.findByText("projectWinner · Space")).toBeTruthy();
  expect(screen.getAllByText(/projectWinner/)).toHaveLength(1);
});

it("hides gallery retry when the audience is denied (H18)", async () => {
  settle({ "/api/public/projects?page=1&pageSize=20&search=": new ApiError("no", 403) });
  await renderMobile(<ProjectGalleryScreen />);
  expect(await screen.findByText("apiErrorForbidden")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "retry" })).toBeNull();
  expect(screen.queryByText("projectNoGallery")).toBeNull();
});

it("shows when the gallery opens instead of a permission error (H18)", async () => {
  settle({
    "/api/public/projects?page=1&pageSize=20&search=": new ApiError("closed", 403, "forbidden", {
      reason: "gallery_closed",
      opensAt: "2026-10-18T16:00:00Z",
    }),
  });
  await renderMobile(<ProjectGalleryScreen />);
  expect(await screen.findByText("galleryOpensOn")).toBeTruthy();
  expect(screen.queryByText("apiErrorForbidden")).toBeNull();
});

it("opens the gallery filtered to the linked challenge and sends every chosen challenge (H18)", async () => {
  mockParams = { challengeId: "9" };
  settle({
    "/api/public/projects?page=1&pageSize=20&search=&challengeId=9": {
      items: [{ ...project, name: "Filtered" }],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  });
  await renderMobile(<ProjectGalleryScreen />);
  expect(await screen.findByText("Filtered")).toBeTruthy();
  expect(screen.queryByText("projectAllChallenges")).toBeNull();
});

it("matches several chosen challenges against each project when the API filters by one (H18)", async () => {
  mockParams = { challengeId: "9" };
  settle({
    "/api/public/projects?page=1&pageSize=20&search=&challengeId=9": {
      items: [{ ...project, name: "Single" }],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  });
  await renderMobile(<ProjectGalleryScreen />);
  expect(await screen.findByText("Single")).toBeTruthy();
  expect(mockApi).toHaveBeenCalledWith(
    "/api/public/projects?page=1&pageSize=20&search=&challengeId=9",
  );
});

const titles = () => screen.getAllByText(/^Challenge \d\d$/).map((node) => node.props.children);

it("persists a chosen challenge through the API and keeps the catalogue order (H20/H21)", async () => {
  // A stateful server: PUT/DELETE change what the next project read returns.
  const server = new Set<number>([3]);
  mockApi.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/api/public/challenges") return Promise.resolve(catalogue);
    const change = path.match(/^\/api\/me\/projects\/5\/challenges\/(\d+)$/);
    if (change) {
      if (init?.method === "PUT") server.add(Number(change[1]));
      else server.delete(Number(change[1]));
      return Promise.resolve({});
    }
    if (path === "/api/me/projects/5")
      return Promise.resolve({
        ...project,
        canEdit: true,
        challenges: [...server].map((id) => ({
          id,
          title: `Challenge ${String(id).padStart(2, "0")}`,
          mandatory: id === 3,
        })),
      });
    return Promise.resolve({});
  });
  await renderMobile(<ProjectChallengesScreen />);
  await screen.findByText("projectRequired");
  const before = titles();
  expect(before.slice(0, 3)).toEqual(["Challenge 03", "Challenge 01", "Challenge 02"]);
  await fireEvent.press(screen.getByRole("button", { name: "Challenge 09" }));
  await fireEvent.press(screen.getByRole("button", { name: "Challenge 05" }));
  await waitFor(() => expect([...server].sort()).toEqual([3, 5, 9]));
  // Rows did not move: the same order, only the checkmarks changed.
  expect(titles()).toEqual(before);
  expect(
    screen.getByRole("button", { name: "Challenge 05" }).props.accessibilityState.selected,
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Challenge 02" }).props.accessibilityState.selected,
  ).toBe(false);
  // Deselecting also keeps the position.
  await fireEvent.press(screen.getByRole("button", { name: "Challenge 05" }));
  await waitFor(() => expect([...server].sort()).toEqual([3, 9]));
  expect(titles()).toEqual(before);
});

it("reads the real catalogue contract: items with localized titles (H20)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/public/challenges")
      return Promise.resolve({ items: [{ id: 4, title: { en: "Space", es: "Espacio" } }] });
    return Promise.resolve({ ...project, canEdit: true, challenges: [] });
  });
  await renderMobile(<ProjectChallengesScreen />);
  expect(await screen.findByRole("button", { name: "Space" })).toBeTruthy();
});

it("opens the invite sheet from the Team section (H19)", async () => {
  mockApi.mockResolvedValue({});
  await renderMobile(
    <ProjectEditor
      reload={async () => {}}
      project={{ ...project, canEdit: true, canInvite: true }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "projectInvite" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/projects/invite", params: { id: "5" } });
});

it("invites several teammates: each valid email becomes a row, confirm sends them all (H19)", async () => {
  mockApi.mockResolvedValue({});
  await renderMobile(<InviteTeammatesScreen />);
  const confirm = () => mockSetOptions.mock.calls.at(-1)?.[0].headerRight();
  expect(confirm().props.disabled).toBe(true);
  expect(screen.getByLabelText("projectEmail").props.autoFocus).toBe(true);
  await fireEvent.changeText(screen.getByLabelText("projectEmail"), "nope");
  expect(screen.getByRole("button", { name: "add" }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText("projectEmail"), "leo@example.com");
  await fireEvent.press(screen.getByRole("button", { name: "add" }));
  expect(screen.getByText("leo@example.com")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("projectEmail"), "ana@example.com");
  await act(async () => {
    confirm().props.onPress();
  });
  for (const email of ["leo@example.com", "ana@example.com"])
    expect(mockApi).toHaveBeenCalledWith(
      "/api/me/projects/5/invites",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email }) }),
    );
  expect(mockBack).toHaveBeenCalled();
});

it("keeps only the refused recipient and shows why (H19)", async () => {
  mockApi.mockImplementation((_path: string, init?: { body?: string }) =>
    init?.body?.includes("full@example.com")
      ? Promise.reject(new ApiError("full", 409))
      : Promise.resolve({}),
  );
  await renderMobile(<InviteTeammatesScreen />);
  for (const email of ["ok@example.com", "full@example.com"]) {
    await fireEvent.changeText(screen.getByLabelText("projectEmail"), email);
    await fireEvent.press(screen.getByRole("button", { name: "add" }));
  }
  await act(async () => {
    mockSetOptions.mock.calls.at(-1)?.[0].headerRight().props.onPress();
  });
  expect(await screen.findByText("full@example.com")).toBeTruthy();
  expect(screen.queryByText("ok@example.com")).toBeNull();
  expect(screen.getByText("requestError")).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
});

it("leaves a team with the API DELETE contract after confirmation (H19)", async () => {
  mockApi.mockResolvedValue({});
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await renderMobile(<ProjectEditor project={project} reload={async () => {}} />);
  await fireEvent.press(screen.getByRole("button", { name: "projectLeave" }));
  const buttons = alert.mock.calls.at(-1)?.[2];
  await act(async () => {
    buttons?.[1].onPress?.();
  });
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      "/api/me/projects/5/leave",
      expect.objectContaining({ method: "DELETE" }),
    ),
  );
  expect(mockBack).toHaveBeenCalled();
  alert.mockRestore();
});

it("shows photo answers as a carousel that opens full screen (H16)", async () => {
  await renderMobile(
    <DynamicForm
      readOnly
      template={
        [
          { key: "photos", kind: "images", label: { en: "Photos", es: "Fotos", gl: "Fotos" } },
        ] as NativeProject["template"]
      }
      sections={[]}
      responses={{ photos: ["a", "b"] }}
      files={["a", "b"].map((key) => ({
        objectKey: key,
        url: `/f/${key}`,
        fileName: `${key}.jpg`,
        mimeType: "image/jpeg",
      }))}
    />,
  );
  expect(screen.queryByRole("button", { name: "projectAddPhotos" })).toBeNull();
  await fireEvent.press(await screen.findByRole("imagebutton", { name: "Photos, b.jpg" }));
  expect(await screen.findByTestId("photo-carousel")).toBeTruthy();
  expect(screen.getByText("2 / 2")).toBeTruthy();
});

it("suggests diary contacts and invites them by account (H19)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/diary")
      return Promise.resolve({
        items: [
          { id: 1, kind: "person", person: { userId: 7, displayName: "Ana", photoUrl: null } },
          { id: 2, kind: "person", person: { userId: 8, displayName: "Leo", photoUrl: null } },
          { id: 3, kind: "sponsor", person: null },
        ],
      });
    if (path === "/api/me/projects/5") return Promise.resolve(project);
    return Promise.resolve({});
  });
  await renderMobile(<InviteTeammatesScreen />);
  // Ana is already on the team; only Leo is suggested.
  expect(await screen.findByText("Leo")).toBeTruthy();
  expect(screen.queryByText("Ana")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Leo" }));
  await act(async () => {
    mockSetOptions.mock.calls.at(-1)?.[0].headerRight().props.onPress();
  });
  expect(mockApi).toHaveBeenCalledWith(
    "/api/me/projects/5/invites",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ userId: 8 }) }),
  );
});

it("opens a challenge's public brief instead of the gallery (H45)", async () => {
  mockParams = { challengeId: "4" };
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/public/challenges")
      return Promise.resolve({
        items: [
          {
            id: 4,
            title: { en: "Open data" },
            description: { en: "Build with open data." },
            criteria: { en: "Impact and craft." },
            prizes: [{ name: "Drone" }],
            enterprise: { id: 1, name: "Gradiant", logoUrl: null, website: null },
          },
        ],
      });
    return Promise.reject(new ApiError("closed", 403));
  });
  await renderMobile(<ChallengeDetailScreen />);
  expect(await screen.findByText("Build with open data.")).toBeTruthy();
  expect(screen.getByText("Impact and craft.")).toBeTruthy();
  expect(screen.getByText("Gradiant")).toBeTruthy();
  expect(screen.getByText("Drone")).toBeTruthy();
  // The gallery is closed (403): no dead-end row to it.
  expect(screen.queryByText("challengeProjects")).toBeNull();
});

// Last on purpose: the upload it leaves running after the editor closes
// outlives the test and would starve later renders of this file.
it("uploads picked photos one by one and saves them after the editor closes (H16/H20)", async () => {
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: "file:///one.heic", fileName: "one.heic", width: 100, height: 80 },
      { uri: "file:///two.heic", fileName: "two.heic", width: 100, height: 80 },
    ],
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploads = 0;
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/me/projects/9/uploads")) {
      uploads += 1;
      if (uploads === 2) await gate;
      return {
        objectKey: `k${uploads}`,
        url: `/f/${uploads}`,
        fileName: `p${uploads}.jpg`,
        mimeType: "image/jpeg",
      };
    }
    if (path === "/api/me/projects/9/draft") return { revision: 1 };
    return { ...project, id: 9 };
  });
  const { rerender } = await renderMobile(
    <ProjectEditor
      reload={async () => {}}
      project={{
        ...project,
        id: 9,
        canEdit: true,
        template: [
          { key: "photos", kind: "images", label: { en: "Photos", es: "Fotos", gl: "Fotos" } },
        ] as NativeProject["template"],
      }}
    />,
  );
  await fireEvent.press(await screen.findByRole("button", { name: "projectAddPhotos" }));
  await waitFor(() => expect(uploads).toBe(2));
  // Leave while the second photo is still uploading.
  await rerender(<View />);
  await act(async () => {
    release();
  });
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      "/api/me/projects/9/draft",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"photos":["k1","k2"]'),
      }),
    ),
  );
  const keys = mockApi.mock.calls
    .filter(([path]) => String(path).startsWith("/api/me/projects/9/uploads"))
    .map(([, init]) => init.headers["Idempotency-Key"]);
  expect(new Set(keys).size).toBe(2);
});

it("selects catalogue values and proposes several values as arrays (H16)", async () => {
  const changed = jest.fn();
  mockApi.mockImplementation(async (path: string, init?: RequestInit) =>
    path.endsWith("/proposals")
      ? { id: 3, name: JSON.parse(String(init?.body)).name }
      : {
          items: [
            { id: 1, name: "React" },
            { id: 2, name: "TypeScript" },
          ],
        },
  );
  await renderMobile(
    <DynamicForm
      template={[
        {
          key: "tech",
          kind: "library",
          library_id: "11111111-1111-4111-8111-111111111111",
          label: { en: "Technologies", es: "Tecnologías", gl: "Tecnoloxías" },
          required: false,
        },
      ]}
      sections={[]}
      responses={{ tech: ["React"] }}
      onChange={changed}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Technologies" }));
  await waitFor(() => expect(screen.getByText("TypeScript")).toBeTruthy());
  await fireEvent.press(screen.getByRole("checkbox", { name: "TypeScript" }));
  expect(changed).toHaveBeenLastCalledWith("tech", ["React", "TypeScript"]);
  await fireEvent.changeText(screen.getByLabelText("fieldLibrarySearch"), "Rust");
  await fireEvent.press(screen.getByRole("button", { name: "fieldLibraryAdd" }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith("tech", ["React", "Rust"]));
  await fireEvent.changeText(screen.getByLabelText("fieldLibrarySearch"), "Go");
  await fireEvent.press(screen.getByRole("button", { name: "fieldLibraryAdd" }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith("tech", ["React", "Go"]));
});
