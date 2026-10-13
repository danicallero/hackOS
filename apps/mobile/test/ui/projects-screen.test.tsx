import { fireEvent, screen, waitFor } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#171717" }) }));
jest.mock("expo-router", () => ({
  useScrollToTop: jest.fn(),
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => undefined | (() => void)) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(callback, [callback]);
  },
  useLocalSearchParams: () => ({ id: "5" }),
  useNavigation: () => ({ addListener: jest.fn(() => () => {}), setOptions: jest.fn() }),
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
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));

import * as DocumentPicker from "expo-document-picker";
import { DynamicForm } from "@/components/dynamic-form";
import { MyProjectsScreen } from "@/components/my-projects-screen";
import { ProjectEditor, ProjectReadView } from "@/components/project-detail-screen";
import { ProjectGalleryScreen } from "@/components/project-gallery-screen";
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
  mockApi.mockReset();
  mockPush.mockReset();
});
it("keeps creation hidden when server policy denies it and accepts exact project invitation (H19)", async () => {
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/public/challenges") return Promise.resolve([]);
    if (path === "/api/me/projects")
      return Promise.resolve({ projects: [project], canCreate: false });
    if (path === "/api/me/projects/invites")
      return Promise.resolve({ invites: [{ id: 8, projectId: 8, name: "Lander" }] });
    if (path === "/api/me/project-gallery-consent")
      return Promise.resolve({ showName: true, showPhoto: false });
    return Promise.resolve({});
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("Rover")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "createProject" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "projectAccept" }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      "/api/me/projects/8/invites/accept",
      expect.objectContaining({ method: "POST" }),
    ),
  );
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
  expect(screen.getByText("projectWinner · Space")).toBeTruthy();
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
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/public/challenges") return Promise.resolve([]);
    if (path === "/api/me/projects")
      return Promise.resolve({ projects: [{ ...project, canEdit: false }], canCreate: false });
    if (path === "/api/me/projects/invites") return Promise.resolve({ invites: [] });
    if (path === "/api/me/project-gallery-consent")
      return Promise.resolve({ showName: true, showPhoto: false });
    return Promise.resolve({});
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("projectLocked")).toBeTruthy();
  expect(screen.getByLabelText("projectName").props.editable).toBe(false);
  expect(
    screen.getByRole("button", { name: "projectSubmit" }).props.accessibilityState.disabled,
  ).toBe(true);
});

const settle = (overrides: Record<string, unknown>) =>
  mockApi.mockImplementation((path: string) => {
    if (path in overrides) {
      const value = overrides[path];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (path === "/api/public/challenges") return Promise.resolve([]);
    if (path === "/api/me/project-gallery-consent")
      return Promise.resolve({ showName: true, showPhoto: false });
    return Promise.resolve({});
  });

it("lists several projects as grouped rows and opens the chosen one (R006)", async () => {
  settle({
    "/api/me/projects": {
      projects: [project, { ...project, id: 6, name: "Lander", submissionStatus: "submitted" }],
      canCreate: true,
    },
    "/api/me/projects/invites": { invites: [] },
  });
  await renderMobile(<MyProjectsScreen />);
  expect(await screen.findByText("Lander")).toBeTruthy();
  expect(screen.getByText("projectSubmitted")).toBeTruthy();
  expect(screen.getByText("projectDraft")).toBeTruthy();
  expect(screen.queryByLabelText("projectName")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Lander" }));
  expect(mockPush).toHaveBeenCalledWith("/projects/6");
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
  expect(await screen.findByLabelText("projectName")).toBeTruthy();
  expect(screen.getByText("apiErrorServer")).toBeTruthy();
});

it("surfaces a failed decline and refreshes the stale invitation list (H19)", async () => {
  let invites = [{ id: 8, projectId: 8, name: "Lander" }];
  mockApi.mockImplementation((path: string) => {
    if (path === "/api/me/projects/8/invites/decline") {
      invites = [];
      return Promise.reject(new ApiError("gone", 409));
    }
    if (path === "/api/me/projects")
      return Promise.resolve({ projects: [project], canCreate: false });
    if (path === "/api/me/projects/invites") return Promise.resolve({ invites });
    if (path === "/api/me/project-gallery-consent")
      return Promise.resolve({ showName: true, showPhoto: false });
    return Promise.resolve([]);
  });
  await renderMobile(<MyProjectsScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "projectDecline" }));
  expect(await screen.findByText("requestError")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("button", { name: "projectDecline" })).toBeNull());
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

it("locks challenge rows when editing is closed (H17)", async () => {
  mockApi.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/public/challenges" ? [{ id: 1, title: "Space" }] : {}),
  );
  await renderMobile(
    <ProjectEditor reload={async () => {}} project={{ ...project, canEdit: false }} />,
  );
  const row = await screen.findByRole("button", { name: "Space" });
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
