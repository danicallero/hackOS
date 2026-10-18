import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

const mockSetOptions = jest.fn();
const mockBack = jest.fn();
let mockCapabilities = ["projects:edit"];
const mockT = (key: string, params?: Record<string, string>) =>
  ({
    back: "Back",
    cancel: "Cancel",
    queueOpsUnnamedTeam: "Unnamed team",
    queueStatusWaiting: "Waiting",
    teamDetailQueue: "Queue",
    teamDetailChallenge: "Challenge",
    teamDetailRoom: "Room",
    teamDetailMembers: "Team members",
    teamDetailAddMember: "Add member",
    teamDetailAddMemberHint: "Search for an account.",
    teamDetailMemberSearch: "Search accounts",
    teamDetailMemberSearchPlaceholder: "Name or email",
    teamDetailNoMemberCandidates: "No accounts match that search.",
    teamDetailMemberCandidateCount: `${params?.count} account candidates`,
    teamDetailAddCandidate: `Add ${params?.name}`,
    teamDetailRemoveMember: "Remove member",
    teamDetailRemoveMemberConfirm: `Remove ${params?.name}?`,
    teamDetailMemberAddedByStaff: "Added by staff",
  })[key] ?? key;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ entryId: "900", roomId: "4" }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useRouter: () => ({ back: mockBack }),
}));

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { capabilities: mockCapabilities } }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentSurface: "#eaf2ff",
    background: "#f5f5f7",
    destructive: "#d70015",
    destructiveSurface: "#fff0f0",
    elevatedSurface: "#eeeeee",
    label: "#171717",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    success: "#0a7f3f",
    successSurface: "#e8f7ee",
    surface: "#ffffff",
    tertiaryLabel: "#7c7c80",
  },
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: mockT }),
}));

import { TeamOperationsScreen } from "@/components/team-operations-screen";
import { apiFetch } from "@/lib/api";
import { renderMobile } from "./render";

const mockApiFetch = apiFetch as jest.Mock;

const manualMember = {
  email: "staff-added@example.com",
  name: "Staff",
  surname: "Added",
  userId: 12,
};

function roomView(members = [manualMember]) {
  return {
    room: { id: 4, name: "Aula 3.0", location: null },
    challenge: { id: 7, title: "Retos GPUL", enterprise_name: "GPUL" },
    active: null,
    called: [],
    next: [
      {
        id: 900,
        repo_id: 44,
        repo_name: "K2 Platform",
        repo_members: members,
        status: "waiting",
        position: 2,
        eta_minutes: null,
        call_count: 0,
      },
    ],
  };
}

function arrange(members = [manualMember]) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === "/api/queue/rooms/4/view") return Promise.resolve(roomView(members));
    if (path === "/api/queue/entries/900/history") return Promise.resolve([]);
    if (path.startsWith("/api/projects/member-candidates")) {
      return Promise.resolve({
        users: [{ id: 31, email: "ada@example.com", name: "Ada", surname: "Lovelace" }],
      });
    }
    return Promise.resolve({});
  });
}

describe("team member controls (H21)", () => {
  beforeEach(() => {
    mockCapabilities = ["projects:edit"];
    mockApiFetch.mockReset();
    mockSetOptions.mockClear();
    arrange();
  });

  it("gates roster mutations on projects:edit, not queue access", async () => {
    mockCapabilities = ["queue:operate"];
    await renderMobile(<TeamOperationsScreen />);

    await waitFor(() => expect(screen.getByText("Staff Added")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove member/ })).toBeNull();
  });

  it("searches project-edit member candidates and adds the selected account through the repo endpoint", async () => {
    await renderMobile(<TeamOperationsScreen />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Search accounts" })).toBeTruthy(),
    );

    fireEvent.changeText(screen.getByPlaceholderText("Name or email"), "ada");
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Name or email").props.value).toBe("ada"),
    );
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Search accounts" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Ada Lovelace" })).toBeTruthy(),
    );
    expect(mockApiFetch).toHaveBeenCalledWith("/api/projects/member-candidates?q=ada");

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Add Ada Lovelace" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/repos/44/members",
        expect.objectContaining({
          body: JSON.stringify({ userId: 31 }),
          method: "POST",
        }),
      ),
    );
  });

  it("removes members through the single project roster (H21)", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await renderMobile(<TeamOperationsScreen />);
    await waitFor(() => expect(screen.getByText("Staff Added")).toBeTruthy());
    fireEvent.press(screen.getByRole("button", { name: "Remove member" }));
    const actions = alert.mock.calls[0]?.[2] as Array<{ onPress?: () => Promise<void> }>;
    await act(async () => {
      await actions[1]?.onPress?.();
    });
    expect(mockApiFetch).toHaveBeenCalledWith("/api/repos/44/members/12", { method: "DELETE" });
    alert.mockRestore();
  });
});
