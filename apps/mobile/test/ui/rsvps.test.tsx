import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

// H59: general RSVP answers in Account and next-entry onboarding.

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockApiFetch = jest.fn();
const mockCache = new Map<string, { data: unknown; updatedAt: string }>();
let mockParams: Record<string, string> = {};

const baseMe = {
  id: 7,
  email: "sponsor@example.com",
  emailVerified: true,
  name: "Grace",
  surname: "Hopper",
  image: null,
  dni: null,
  badgeId: null,
  language: "en",
  foodIntolerances: [] as number[],
  foodIntoleranceNotes: null as string | null,
  shirtSize: null,
  notes: null,
  accountState: "active" as const,
  removal: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  visibleRoleName: "sponsor",
  hasEventAccess: true,
  hasQueueItems: false,
  capabilities: [] as string[],
  dietaryConfirmedAt: null as string | null,
  profileLocked: false,
  dietaryLocked: false,
  isSponsorRep: true,
  pendingProfileTasks: ["dietary", "meal_plan"] as ("dietary" | "meal_plan")[],
};
const mockMeContext = {
  me: { ...baseMe },
  loading: false,
  error: null,
  offline: false,
  staleSince: null,
  refetch: jest.fn().mockResolvedValue(undefined),
};

jest.mock("@/components/segmented-control", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    SegmentedControl: ({
      label,
      values,
      onChange,
    }: {
      label: string;
      values: string[];
      onChange: (index: number) => void;
    }) =>
      ReactLib.createElement(
        Native.View,
        null,
        values.map((value, index) =>
          ReactLib.createElement(
            Native.Pressable,
            {
              key: value,
              accessibilityLabel: `${label}: ${value}`,
              onPress: () => onChange(index),
            },
            ReactLib.createElement(Native.Text, null, value),
          ),
        ),
      ),
  };
});
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children }: { children: unknown }) => children,
}));
jest.mock("expo-router", () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  useScrollToTop: jest.fn(),
}));
jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  const box = ({ children }: { children?: unknown }) =>
    ReactLib.createElement(Native.View, null, children);
  return {
    ActionButton: ({
      busy,
      disabled,
      label,
      onPress,
    }: {
      busy?: boolean;
      disabled?: boolean;
      label: string;
      onPress: () => void;
    }) =>
      ReactLib.createElement(
        Native.Pressable,
        {
          accessibilityLabel: label,
          accessibilityRole: "button",
          accessibilityState: { disabled: busy || disabled },
          disabled: busy || disabled,
          onPress,
        },
        ReactLib.createElement(Native.Text, null, label),
      ),
    AndroidStatusBarScrim: () => null,
    FloatingGlassButton: ({
      accessibilityLabel,
      accessibilityState,
      disabled,
      onPress,
    }: {
      accessibilityLabel: string;
      accessibilityState?: { busy?: boolean };
      disabled?: boolean;
      onPress: () => void;
    }) =>
      ReactLib.createElement(Native.Pressable, {
        accessibilityLabel,
        accessibilityRole: "button",
        accessibilityState: { ...accessibilityState, disabled },
        disabled,
        onPress,
      }),
    InfoRow: ({ label, value }: { label: string; value: string }) =>
      ReactLib.createElement(
        Native.View,
        null,
        ReactLib.createElement(Native.Text, null, label),
        ReactLib.createElement(Native.Text, null, value),
      ),
    Section: ({
      title,
      footer,
      children,
    }: {
      title?: string;
      footer?: string;
      children: unknown;
    }) =>
      ReactLib.createElement(
        Native.View,
        null,
        title ? ReactLib.createElement(Native.Text, null, title) : null,
        children,
        footer ? ReactLib.createElement(Native.Text, null, footer) : null,
      ),
    Separator: box,
    StatusPill: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.Text, null, children),
    ToggleRow: ({
      label,
      value,
      disabled,
      onChange,
    }: {
      label: string;
      value: boolean;
      disabled?: boolean;
      onChange: (value: boolean) => void;
    }) =>
      ReactLib.createElement(Native.Switch, {
        accessibilityLabel: label,
        disabled,
        onValueChange: onChange,
        value,
      }),
  };
});
jest.mock("@/components/RequestFeedback", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    RequestFeedback: ({
      error,
      message,
      onRetry,
    }: {
      error?: Error | null;
      message?: string;
      onRetry?: () => void;
    }) =>
      error
        ? ReactLib.createElement(
            Native.View,
            null,
            ReactLib.createElement(Native.Text, null, message ?? error.message),
            onRetry
              ? ReactLib.createElement(
                  Native.Pressable,
                  { accessibilityLabel: "retry", accessibilityRole: "button", onPress: onRetry },
                  ReactLib.createElement(Native.Text, null, "retry"),
                )
              : null,
          )
        : null,
  };
});
jest.mock("@/components/account-wallet", () => ({
  AccountWalletButton: () => null,
  AccountWalletOverlay: () => null,
  useAccountWallet: () => ({}),
}));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));
jest.mock("@/lib/api-mode", () => ({
  useApiMode: () => ({ mode: "production", setMode: jest.fn() }),
}));
jest.mock("@/lib/app-version", () => ({ appVersionLabel: "1.0.0" }));
jest.mock("@/lib/auth-client", () => ({ forceLocalSignOut: jest.fn(), signOut: jest.fn() }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => mockMeContext }));
jest.mock("@/lib/offline-cache", () => ({
  readCachedValue: async (key: string) => mockCache.get(key) ?? null,
  writeCachedValue: async (key: string, data: unknown) => {
    mockCache.set(key, { data, updatedAt: "2026-10-10T08:00:00.000Z" });
  },
}));
jest.mock("@/lib/role-filters", () => ({ roleDisplayName: (role: string) => role }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/lib/scanner-db", () => ({ wipeAttendanceRoster: jest.fn() }));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#000000" }) }));
jest.mock("@/lib/use-retry-on-reconnect", () => ({ useRetryOnReconnect: jest.fn() }));

import AccountScreen from "@/components/account-screen";
import ProfileTasksScreen from "@/components/profile-tasks-screen";
import RsvpsScreen from "@/components/rsvps-screen";
import { renderMobile } from "./render";

const lunch = {
  activityId: 11,
  name: "Lunch",
  description: null,
  date: "2030-10-17T11:30:00.000Z",
  closesAt: "2030-10-16T11:30:00.000Z",
  location: null,
  answer: null,
  locked: false,
  isMeal: true,
};
const dinner = { ...lunch, activityId: 12, name: "Dinner", answer: "yes", locked: true };
const workshop = { ...lunch, activityId: 13, name: "Workshop", isMeal: false };
const plan = { items: [lunch, dinner, workshop] };
const intolerances = [{ id: 3, label: { en: "Gluten", es: "Gluten", gl: "Glute" } }];

function routeApi(overrides: Record<string, (init?: RequestInit) => unknown> = {}) {
  mockApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${path}`;
    if (overrides[key]) return overrides[key](init);
    if (path === "/api/public/food-intolerances") return { intolerances };
    if (key === "GET /api/me/rsvps") return plan;
    if (key === "PUT /api/me/rsvps") return plan;
    if (key === "PATCH /api/me") return {};
    throw new Error(`unexpected ${key}`);
  });
}

function bodyOf(method: string, path: string) {
  const call = mockApiFetch.mock.calls.find(
    ([callPath, init]) => callPath === path && init?.method === method,
  );
  return call ? JSON.parse(call[1].body) : undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.clear();
  mockParams = {};
  mockMeContext.me = { ...baseMe };
  mockMeContext.offline = false;
  routeApi();
});

describe("Account RSVP subpage (H59)", () => {
  it("opens RSVP from Account without rendering the editor inline", async () => {
    await renderMobile(<AccountScreen />);
    expect(screen.queryByText("Workshop")).toBeNull();
    await act(async () =>
      fireEvent.press(await screen.findByRole("button", { name: "profileRsvpTitle" })),
    );
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/rsvps");
    expect(mockApiFetch).toHaveBeenCalledWith("/api/me/rsvps", expect.anything());
  });

  it("hides the Account link when no activity is offered to this person's roles", async () => {
    routeApi({ "GET /api/me/rsvps": () => ({ items: [] }) });
    await renderMobile(<AccountScreen />);
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/me/rsvps", expect.anything()),
    );
    expect(screen.queryByRole("button", { name: "profileRsvpTitle" })).toBeNull();
  });

  it("offers activities to non-sponsors and saves only explicitly changed answers", async () => {
    mockMeContext.me = { ...baseMe, isSponsorRep: false };
    await renderMobile(<RsvpsScreen />);
    await screen.findByText("Workshop");
    expect(screen.queryByLabelText("Dinner: rsvpNo")).toBeNull();
    expect(bodyOf("PUT", "/api/me/rsvps")).toBeUndefined();
    await act(async () => fireEvent.press(screen.getByLabelText("Workshop: rsvpUnsure")));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(bodyOf("PUT", "/api/me/rsvps")).toEqual({
      answers: [{ activityId: 13, answer: "unsure" }],
    });
    expect(mockApiFetch).not.toHaveBeenCalledWith("/api/me/meal-plan", expect.anything());
  });

  it("shows errors and reloads offers after a rejected save", async () => {
    routeApi({
      "PUT /api/me/rsvps": () => {
        throw new Error("rsvp_locked");
      },
    });
    await renderMobile(<RsvpsScreen />);
    await act(async () => fireEvent.press(await screen.findByLabelText("Lunch: rsvpYes")));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(await screen.findByText("couldNotSaveRsvps")).toBeTruthy();
  });

  it("keeps cached answers visible and read-only offline", async () => {
    mockCache.set("user:7:rsvps", { data: plan, updatedAt: "2026-10-09T08:00:00.000Z" });
    mockMeContext.offline = true;
    routeApi({
      "GET /api/me/rsvps": () => {
        throw new Error("offline");
      },
    });
    await renderMobile(<RsvpsScreen />);
    await screen.findByText("Workshop");
    expect(screen.queryByLabelText("Workshop: rsvpYes")).toBeNull();
  });

  it("shows an empty RSVP section instead of making the destination disappear", async () => {
    routeApi({ "GET /api/me/rsvps": () => ({ items: [] }) });
    await renderMobile(<RsvpsScreen />);
    expect(await screen.findByText("rsvpNoItems")).toBeTruthy();
  });
});

describe("Profile tasks sheet", () => {
  it("asks a non-sponsor for activity RSVPs on entry and leaves unanswered items untouched", async () => {
    mockMeContext.me = { ...baseMe, isSponsorRep: false };
    mockParams = { tasks: "rsvp" };
    await renderMobile(<ProfileTasksScreen />);
    await act(async () => fireEvent.press(await screen.findByLabelText("Workshop: rsvpNo")));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(bodyOf("PUT", "/api/me/rsvps")).toEqual({ answers: [{ activityId: 13, answer: "no" }] });
    expect(mockBack).toHaveBeenCalled();
  });

  it("uses the general RSVP editor for the legacy meal-plan task too", async () => {
    mockParams = { tasks: "meal_plan" };
    await renderMobile(<ProfileTasksScreen />);
    await screen.findByText("Lunch");
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(bodyOf("PUT", "/api/me/rsvps")).toEqual({ answers: [] });
  });

  it("records No restrictions explicitly before saving RSVPs", async () => {
    mockParams = { tasks: "dietary,rsvp" };
    await renderMobile(<ProfileTasksScreen />);
    await act(async () =>
      fireEvent(await screen.findByLabelText("noRestrictions"), "valueChange", true),
    );
    await act(async () => fireEvent.press(await screen.findByLabelText("Lunch: rsvpYes")));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(bodyOf("PATCH", "/api/me")).toEqual({
      foodIntolerances: [],
      foodIntoleranceNotes: null,
    });
    expect(bodyOf("PUT", "/api/me/rsvps")).toEqual({
      answers: [{ activityId: 11, answer: "yes" }],
    });
  });

  it("defers without saving any answers", async () => {
    mockParams = { tasks: "rsvp" };
    await renderMobile(<ProfileTasksScreen />);
    await screen.findByText("Workshop");
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "profileTasksLater" })),
    );
    expect(mockBack).toHaveBeenCalled();
    expect(bodyOf("PUT", "/api/me/rsvps")).toBeUndefined();
  });

  it("saves dietary alone when the RSVP read fails", async () => {
    mockParams = { tasks: "dietary,rsvp" };
    routeApi({
      "GET /api/me/rsvps": () => {
        throw new Error("network");
      },
    });
    await renderMobile(<ProfileTasksScreen />);
    await screen.findByText("network");
    await act(async () => fireEvent(screen.getByLabelText("noRestrictions"), "valueChange", true));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(bodyOf("PATCH", "/api/me")).toEqual({
      foodIntolerances: [],
      foodIntoleranceNotes: null,
    });
    expect(bodyOf("PUT", "/api/me/rsvps")).toBeUndefined();
  });

  it("retains the dietary save if RSVP saving fails and is retried", async () => {
    mockParams = { tasks: "dietary,rsvp" };
    let fail = true;
    routeApi({
      "PUT /api/me/rsvps": () => {
        if (fail) throw new Error("rsvp_locked");
        return plan;
      },
    });
    await renderMobile(<ProfileTasksScreen />);
    await screen.findByText("Workshop");
    await act(async () => fireEvent(screen.getByLabelText("noRestrictions"), "valueChange", true));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    await screen.findByText("couldNotSaveRsvps");
    expect(mockBack).not.toHaveBeenCalled();
    fail = false;
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "retry" })));
    expect(
      mockApiFetch.mock.calls.filter(
        ([path, init]) => path === "/api/me" && init?.method === "PATCH",
      ),
    ).toHaveLength(1);
    expect(mockBack).toHaveBeenCalled();
  });
});

describe("Dietary tasks", () => {
  it("stays open with an error when the dietary save fails", async () => {
    mockParams = { tasks: "dietary" };
    routeApi({
      "PATCH /api/me": () => {
        throw new Error("profile_locked");
      },
    });
    await renderMobile(<ProfileTasksScreen />);
    await act(async () => fireEvent(await screen.findByLabelText("Gluten"), "valueChange", true));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));

    expect(bodyOf("PATCH", "/api/me")).toEqual({
      foodIntolerances: [3],
      foodIntoleranceNotes: null,
    });
    expect(await screen.findByText("dietarySaveError")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("sends trimmed dietary notes and keeps the field read-only under No restrictions", async () => {
    mockParams = { tasks: "dietary" };
    await renderMobile(<ProfileTasksScreen />);
    const notes = await screen.findByLabelText("accountDietaryNotes");
    expect(notes.props.editable).toBe(true);
    await act(async () => fireEvent.changeText(notes, " no peanuts "));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(bodyOf("PATCH", "/api/me")).toEqual({
      foodIntolerances: [],
      foodIntoleranceNotes: "no peanuts",
    });
  });

  it("locks the notes field once No restrictions is chosen", async () => {
    mockParams = { tasks: "dietary" };
    await renderMobile(<ProfileTasksScreen />);
    await act(async () =>
      fireEvent(await screen.findByLabelText("noRestrictions"), "valueChange", true),
    );
    expect(screen.getByLabelText("accountDietaryNotes").props.editable).toBe(false);
  });

  it("defers with Later without saving", async () => {
    mockParams = { tasks: "dietary" };
    await renderMobile(<ProfileTasksScreen />);
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "profileTasksLater" })),
    );
    expect(mockBack).toHaveBeenCalled();
    expect(bodyOf("PATCH", "/api/me")).toBeUndefined();
  });
});

describe("Next-entry presentation", () => {
  it("records the prompt as shown only when the sheet opens, not from Account", async () => {
    const { resetProfileTasksHandled, shouldPresentProfileTasks } = require("@/lib/profile-tasks");
    const ready = {
      me: mockMeContext.me,
      offline: false,
      navigationReady: true,
      sessionPending: false,
      pathname: "/schedule",
    };
    resetProfileTasksHandled();
    mockParams = { tasks: "dietary", edit: "1" };
    const edit = await renderMobile(<ProfileTasksScreen />);
    expect(shouldPresentProfileTasks(ready)).toBe(true);
    edit.unmount();
    mockParams = { tasks: "dietary" };
    await renderMobile(<ProfileTasksScreen />);
    expect(shouldPresentProfileTasks(ready)).toBe(false);
  });
});

describe("Locked dietary data", () => {
  it("asks for RSVPs without changing the locked dietary answer", async () => {
    mockParams = { tasks: "dietary,rsvp" };
    mockMeContext.me = {
      ...baseMe,
      dietaryLocked: true,
      profileLocked: true,
      foodIntolerances: [3],
    };
    await renderMobile(<ProfileTasksScreen />);
    await screen.findByText("Workshop");
    expect(screen.queryByLabelText("noRestrictions")).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(bodyOf("PATCH", "/api/me")).toBeUndefined();
    expect(bodyOf("PUT", "/api/me/rsvps")).toEqual({ answers: [] });
  });
});
