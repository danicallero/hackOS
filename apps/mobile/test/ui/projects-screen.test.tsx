import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

let mockParams: Record<string, string> = { id: "5" };
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockSetOptions = jest.fn();
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#171717" }) }));
jest.mock("expo-router", () => ({
  useScrollToTop: jest.fn(),
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useFocusEffect: (callback: () => undefined | (() => void)) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(callback, [callback]);
  },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ addListener: jest.fn(() => () => {}), setOptions: mockSetOptions }),
}));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
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
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));

import * as DocumentPicker from "expo-document-picker";
import { DynamicForm } from "@/components/dynamic-form";
import { MyProjectsScreen } from "@/components/my-projects-screen";
import { NewProjectScreen } from "@/components/new-project-screen";
import { ProjectChallengesScreen } from "@/components/project-challenges-screen";
import { ProjectEditor, ProjectReadView } from "@/components/project-detail-screen";
import { ProjectGalleryScreen } from "@/components/project-gallery-screen";
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
  mockParams = { id: "5" };
  mockApi.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
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
  expect(mockBack).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/projects/12");
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

it("disables participant edits and submission when the server closes editing (H17/H20)", async () => {
  mockApi.mockResolvedValue([]);
  await renderMobile(
    <ProjectEditor reload={async () => {}} project={{ ...project, canEdit: false }} />,
  );
  expect(await screen.findByText("projectLocked")).toBeTruthy();
  expect(screen.getByLabelText("projectName").props.editable).toBe(false);
  expect(
    screen.getByRole("button", { name: "projectSubmit" }).props.accessibilityState.disabled,
  ).toBe(true);
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
  expect(screen.getByText("projectDeadline")).toBeTruthy();
});

const settle = (overrides: Record<string, unknown>) =>
  mockApi.mockImplementation((path: string) => {
    if (path in overrides) {
      const value = overrides[path];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (path === "/api/public/challenges") return Promise.resolve([]);
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

it("explains an oversized upload rejected by the server (H16)", async () => {
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
const pickerApi = (
  selected: { id: number; title: string; mandatory?: boolean }[],
  canEdit = true,
) =>
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/public/challenges") return Promise.resolve(manyChallenges);
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
    if (path === "/api/public/challenges") return Promise.resolve(manyChallenges);
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
