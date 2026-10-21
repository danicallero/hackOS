import { act, screen, waitFor } from "@testing-library/react-native";

const mockSetOptions = jest.fn();
const mockListPeople = jest.fn();
const mockPush = jest.fn();
let mockFilterActive = false;
let mockFilterSelect: (id: string) => void;
jest.mock("@/components/filter-menu", () => ({
  FilterMenu: ({ onSelect, active }: { onSelect: (id: string) => void; active: boolean }) => {
    mockFilterSelect = onSelect;
    mockFilterActive = active;
    return null;
  },
}));
jest.mock("expo-router/stack", () => {
  const Toolbar = Object.assign(({ children }: { children: unknown }) => children, {
    View: ({ children }: { children: unknown }) => children,
  });
  return { __esModule: true, default: { Toolbar } };
});
let mockActivityId: string | undefined;

jest.mock("@/components/header-back-button", () => ({ EntryBackToolbar: () => null }));
jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useLocalSearchParams: () => ({ activityId: mockActivityId }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  usePathname: () => "/scan/people",
  useRouter: () => ({ push: mockPush }),
  useScrollToTop: () => {},
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => true,
}));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: jest.fn(),
}));
jest.mock("@/lib/scanner-db", () => ({ listScannerPeople: () => mockListPeople() }));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({ sync: jest.fn(), lastSync: null, serverSnapshot: null }),
  isSyncConflict: () => false,
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    background: "#ffffff",
    label: "#171717",
    secondaryLabel: "#5f6368",
    tertiaryLabel: "#7c7c80",
    separator: "#d1d1d6",
    surface: "#ffffff",
  },
}));

import { PeopleDirectoryScreen } from "@/components/people-directory-screen";
import type { ScannerPerson } from "@/lib/scanner-types";
import { renderMobile } from "./render";

function person(
  userId: number,
  name: string,
  role: string | null,
  badgeId: string | null,
): ScannerPerson {
  return {
    userId,
    name,
    role,
    badgeId,
    email: `${name}@example.com`,
    surname: null,
    dni: null,
    hasCapabilities: false,
    isEnterpriseJudge: false,
    eventAccess: true,
    ticketToken: null,
    revokedBadgeIds: [],
    accepted: true,
    confirmed: true,
    intolerances: [],
    foodIntoleranceNotes: null,
    notes: null,
    lastPresenceKind: null,
    lastPresenceAt: null,
  };
}
const PEOPLE = [
  person(1, "Ada", "participant", "badge1"),
  person(2, "Grace", "mentor", "badge2"),
  person(3, "Linus", null, null),
];

async function select(id: string) {
  await act(async () => mockFilterSelect(id));
}

describe("people directory role filters", () => {
  beforeEach(() => {
    mockActivityId = undefined;
    mockSetOptions.mockClear();
    mockListPeople.mockReset().mockResolvedValue(PEOPLE);
  });

  it("combines roles, toggles individual choices and restores unassigned people with All", async () => {
    await renderMobile(<PeopleDirectoryScreen />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    await select("participant");
    expect(screen.queryByText("Grace")).toBeNull();
    expect(screen.queryByText("Linus")).toBeNull();
    await select("mentor");
    expect(screen.getByText("Grace")).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
    await select("participant");
    expect(screen.queryByText("Ada")).toBeNull();
    await select("all");
    expect(screen.getByText("Linus")).toBeTruthy();
    expect(mockFilterActive).toBe(false);
  });

  it("has exactly one title in the pane's native stack: the bar's large title", async () => {
    await renderMobile(<PeopleDirectoryScreen embedded nativeHeader backLabel="scannerBack" />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    // No list-header or band title: the native bar owns it and collapses it on scroll.
    expect(screen.queryAllByText("scannerPeople")).toHaveLength(0);
    expect(mockSetOptions).toHaveBeenCalledWith(
      expect.objectContaining({ headerLargeTitle: true, title: "scannerPeople" }),
    );
  });

  it("preserves the activity badge restriction and search within selected roles", async () => {
    mockActivityId = "7";
    await renderMobile(<PeopleDirectoryScreen />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    expect(screen.queryByText("Linus")).toBeNull();
    await select("participant");
    await select("mentor");
    await act(async () =>
      mockSetOptions.mock.calls.at(-1)?.[0].headerSearchBarOptions.onChangeText({
        nativeEvent: { text: "grace@example.com" },
      }),
    );
    expect(screen.getByText("Grace")).toBeTruthy();
    expect(screen.queryByText("Ada")).toBeNull();
  });
});
