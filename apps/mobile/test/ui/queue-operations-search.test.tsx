import { act, screen, waitFor } from "@testing-library/react-native";

const mockSetOptions = jest.fn();

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({ setOptions: mockSetOptions }),
  usePathname: () => "/operations",
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: jest.fn(),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: ["queue:operate"] } }),
}));
jest.mock("@/lib/server-events", () => ({
  startQueueEventStream: () => () => {},
  subscribeToServerEvent: () => () => {},
}));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string>) =>
      ({
        queueOpsSearchResultCount: `${params?.count} results`,
        queueOpsSearchResultCountOne: "1 result",
        scannerNoResults: "No results",
        queueOpsNoSearchResults: "No teams or people match this search.",
        queuePossibleRoomsLabel: "Possible rooms",
        queuePositionLabel: "Position",
        queueStatusWaiting: "Waiting",
      })[key] ?? key,
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentSurface: "#eaf2ff",
    background: "#f5f5f7",
    destructive: "#d70015",
    destructiveSurface: "#fff0f0",
    label: "#171717",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    success: "#0a7f3f",
    successSurface: "#e8f7ee",
    surface: "#ffffff",
    tertiaryLabel: "#7c7c80",
    warning: "#b25000",
    warningSurface: "#fff4e5",
  },
}));

import { QueueOperationsScreen } from "@/components/queue-operations-screen";
import { apiFetch } from "@/lib/api";
import type { RoomView } from "@/lib/queue-search";
import { renderMobile } from "./render";

const mockApiFetch = apiFetch as jest.Mock;

const team = {
  id: 900,
  repo_name: "K2 Platform",
  repo_members: [{ email: "daniel@example.com", name: "Daniel", surname: "Callero" }],
  position: 61,
  status: "waiting",
};

/** The API repeats the same waiting entry in every room that judges its challenge. */
function roomViewFor(id: number, name: string): RoomView {
  return {
    room: { id, name, location: null },
    state: { is_paused: false },
    challenge: { id: 7, title: "Retos GPUL", enterprise_name: "GPUL" },
    active: null,
    called: [],
    next: [team],
  };
}

const ROOMS = [
  roomViewFor(1, "Aula 3.0"),
  roomViewFor(2, "Aula 3.1"),
  roomViewFor(3, "Aula 3.6"),
  roomViewFor(4, "Aula 3.9"),
];

/** Drives the native `headerSearchBarOptions` search bar the screen installs. */
async function search(text: string) {
  const options = mockSetOptions.mock.calls.at(-1)?.[0];
  await act(async () => {
    options.headerSearchBarOptions.onChangeText({ nativeEvent: { text } });
  });
}

describe("queue operations search (H29-H31)", () => {
  beforeEach(() => {
    mockSetOptions.mockClear();
    mockApiFetch.mockReset().mockImplementation((path: string) => {
      if (path === "/api/queue/rooms") return Promise.resolve(ROOMS.map(({ room }) => room));
      const roomId = Number(path.split("/")[4]);
      return Promise.resolve(ROOMS.find((view) => view.room.id === roomId));
    });
  });

  it("shows one card listing every room, plus the result count", async () => {
    await renderMobile(<QueueOperationsScreen />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(ROOMS.length + 1));

    expect(mockSetOptions.mock.calls.at(-1)?.[0].headerSearchBarOptions).toMatchObject({
      allowToolbarIntegration: true,
      hideWhenScrolling: true,
      placement: "integratedButton",
    });
    expect(mockSetOptions.mock.calls.at(-1)?.[0].headerRight).toEqual(expect.any(Function));

    await search("daniel ca");

    await waitFor(() => expect(screen.getByText("1 result")).toBeTruthy());
    // One card for the entry, not one per room.
    expect(screen.getAllByText("K2 Platform")).toHaveLength(1);
    expect(screen.getByText("Retos GPUL")).toBeTruthy();
    expect(screen.getByText("Possible rooms")).toBeTruthy();
    for (const name of ["Aula 3.0", "Aula 3.1", "Aula 3.6", "Aula 3.9"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("falls back to the empty state, with no duplicate count line, when nothing matches", async () => {
    await renderMobile(<QueueOperationsScreen />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(ROOMS.length + 1));

    await search("nobody");

    await waitFor(() =>
      expect(screen.getByText("No teams or people match this search.")).toBeTruthy(),
    );
    expect(screen.getAllByText("No results")).toHaveLength(1);
    expect(screen.queryByText("K2 Platform")).toBeNull();
  });
});
