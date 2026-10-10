import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

// #933: sponsor meal plan on Account, and the pending-profile-tasks sheet.

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
  secondaryEmail: null,
  secondaryEmailVerified: false,
  foodIntolerances: [] as number[],
  foodIntoleranceNotes: null as string | null,
  shirtSize: null,
  universityId: null,
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

jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children }: { children: unknown }) => children,
}));
jest.mock("expo-router", () => ({
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
import { renderMobile } from "./render";

const lunch = {
  activityId: 11,
  name: "Lunch",
  nameI18n: null,
  startsAt: "2026-10-17T11:30:00.000Z",
  endsAt: "2026-10-17T13:00:00.000Z",
  location: null,
  attending: null,
  locked: false,
};
const dinner = { ...lunch, activityId: 12, name: "Dinner", attending: true, locked: true };
const plan = { confirmedAt: null, meals: [lunch, dinner] };
const intolerances = [{ id: 3, label: { en: "Gluten", es: "Gluten", gl: "Glute" } }];

function routeApi(overrides: Record<string, (init?: RequestInit) => unknown> = {}) {
  mockApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${path}`;
    if (overrides[key]) return overrides[key](init);
    if (path === "/api/public/food-intolerances") return { intolerances };
    if (key === "GET /api/me/meal-plan") return plan;
    if (key === "PUT /api/me/meal-plan") return plan;
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

function label(meal: { name: string; startsAt: string }) {
  return `${new Date(meal.startsAt).toLocaleDateString("en", { weekday: "short" })} ${new Date(
    meal.startsAt,
  ).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })} · ${meal.name}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.clear();
  mockParams = {};
  mockMeContext.me = { ...baseMe };
  mockMeContext.offline = false;
  routeApi();
});

describe("Account meals section", () => {
  it("submits every unlocked meal only on an explicit Save", async () => {
    await renderMobile(<AccountScreen />);
    const toggle = await screen.findByLabelText(label(lunch));
    expect(screen.getByLabelText(label(dinner)).props.disabled).toBe(true);

    await act(async () => fireEvent(toggle, "valueChange", true));
    expect(bodyOf("PUT", "/api/me/meal-plan")).toBeUndefined();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));

    await waitFor(() =>
      expect(bodyOf("PUT", "/api/me/meal-plan")).toEqual({
        meals: [{ activityId: 11, attending: true }],
      }),
    );
  });

  it("shows the save error when the plan is rejected", async () => {
    routeApi({
      "PUT /api/me/meal-plan": () => {
        throw new Error("meal_plan_locked");
      },
    });
    await renderMobile(<AccountScreen />);
    await act(async () =>
      fireEvent(await screen.findByLabelText(label(lunch)), "valueChange", true),
    );
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(await screen.findByText("mealPlanSaveError")).toBeTruthy();
    // A rejected plan (e.g. a meal locked meanwhile) reloads the server state.
    expect(
      mockApiFetch.mock.calls.filter(
        ([path, init]) => path === "/api/me/meal-plan" && !init?.method,
      ),
    ).toHaveLength(2);
  });

  it("keeps the cached plan read-only offline", async () => {
    mockCache.set("user:7:meal-plan", { data: plan, updatedAt: "2026-10-09T08:00:00.000Z" });
    mockMeContext.offline = true;
    routeApi({
      "GET /api/me/meal-plan": () => {
        throw new Error("offline");
      },
    });
    await renderMobile(<AccountScreen />);
    expect((await screen.findByLabelText(label(lunch))).props.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "accountFoodIntolerances" })).toBeNull();
  });

  it("never answers the other open meals when one is toggled", async () => {
    const breakfast = { ...lunch, activityId: 10, name: "Breakfast" };
    const open = { confirmedAt: null, meals: [breakfast, lunch] };
    routeApi({ "GET /api/me/meal-plan": () => open, "PUT /api/me/meal-plan": () => open });
    await renderMobile(<AccountScreen />);
    await act(async () =>
      fireEvent(await screen.findByLabelText(label(lunch)), "valueChange", true),
    );
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      "/api/me/meal-plan",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(screen.getByLabelText(label(breakfast)).props.value).toBe(false);
  });

  it("hides Save once every open meal is answered and unchanged", async () => {
    const answered = {
      confirmedAt: "2026-10-09T08:00:00.000Z",
      meals: [{ ...lunch, attending: false }, dinner],
    };
    routeApi({ "GET /api/me/meal-plan": () => answered });
    await renderMobile(<AccountScreen />);
    const toggle = await screen.findByLabelText(label(lunch));
    expect(screen.queryByRole("button", { name: "save" })).toBeNull();
    await act(async () => fireEvent(toggle, "valueChange", true));
    expect(screen.getByRole("button", { name: "save" })).toBeTruthy();
  });

  it("renders without a section on a fresh offline install", async () => {
    mockMeContext.offline = true;
    routeApi({
      "GET /api/me/meal-plan": () => {
        throw new Error("offline");
      },
    });
    await renderMobile(<AccountScreen />);
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/me/meal-plan", expect.anything()),
    );
    expect(screen.queryByText("mealsTitle")).toBeNull();
    expect(screen.getByText("accountNoneDeclared")).toBeTruthy();
  });

  it("hides meals from non-sponsors and shows an explicit empty dietary answer", async () => {
    mockMeContext.me = {
      ...baseMe,
      isSponsorRep: false,
      dietaryConfirmedAt: "2026-10-01T00:00:00.000Z",
    };
    await renderMobile(<AccountScreen />);
    expect(await screen.findByText("noRestrictions")).toBeTruthy();
    expect(screen.queryByText("mealsTitle")).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalledWith("/api/me/meal-plan", expect.anything());
  });
});

describe("Profile tasks sheet", () => {
  it("records No restrictions as an explicit empty answer, then the meal plan", async () => {
    mockParams = { tasks: "dietary,meal_plan" };
    await renderMobile(<ProfileTasksScreen />);
    const save = screen.getByRole("button", { name: "save" });
    expect(save.props.accessibilityState.disabled).toBe(true);

    await act(async () =>
      fireEvent(await screen.findByLabelText("noRestrictions"), "valueChange", true),
    );
    await act(async () =>
      fireEvent(await screen.findByLabelText(label(lunch)), "valueChange", true),
    );
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));

    expect(bodyOf("PATCH", "/api/me")).toEqual({
      foodIntolerances: [],
      foodIntoleranceNotes: null,
    });
    expect(bodyOf("PUT", "/api/me/meal-plan")).toEqual({
      meals: [{ activityId: 11, attending: true }],
    });
    expect(mockMeContext.refetch).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

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

  it("defers with Later without saving", async () => {
    mockParams = { tasks: "dietary" };
    await renderMobile(<ProfileTasksScreen />);
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "profileTasksLater" })),
    );
    expect(mockBack).toHaveBeenCalled();
    expect(bodyOf("PATCH", "/api/me")).toBeUndefined();
  });

  it("skips the dietary step for a locked profile and never sends it", async () => {
    mockParams = { tasks: "dietary,meal_plan" };
    mockMeContext.me = {
      ...baseMe,
      profileLocked: true,
      foodIntolerances: [3],
      foodIntoleranceNotes: " nuts ",
    };
    await renderMobile(<ProfileTasksScreen />);
    await screen.findByLabelText(label(lunch));
    expect(screen.queryByLabelText("noRestrictions")).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));

    expect(bodyOf("PATCH", "/api/me")).toBeUndefined();
    expect(bodyOf("PUT", "/api/me/meal-plan")).toBeDefined();
    expect(mockBack).toHaveBeenCalled();
  });

  it("saves the dietary answer alone when the meal plan cannot load", async () => {
    mockParams = { tasks: "dietary,meal_plan" };
    routeApi({
      "GET /api/me/meal-plan": () => {
        throw new Error("network");
      },
    });
    await renderMobile(<ProfileTasksScreen />);
    expect(await screen.findByText("network")).toBeTruthy();
    await act(async () => fireEvent(screen.getByLabelText("noRestrictions"), "valueChange", true));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));

    expect(bodyOf("PATCH", "/api/me")).toEqual({
      foodIntolerances: [],
      foodIntoleranceNotes: null,
    });
    expect(bodyOf("PUT", "/api/me/meal-plan")).toBeUndefined();
    expect(mockBack).toHaveBeenCalled();
  });

  it("retries a failed meal plan load", async () => {
    mockParams = { tasks: "meal_plan" };
    let fail = true;
    routeApi({
      "GET /api/me/meal-plan": () => {
        if (fail) throw new Error("network");
        return plan;
      },
    });
    await renderMobile(<ProfileTasksScreen />);
    await screen.findByText("network");
    fail = false;
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "retry" })));
    expect(await screen.findByLabelText(label(lunch))).toBeTruthy();
  });

  it("keeps a stored dietary answer when only the meal plan save fails", async () => {
    mockParams = { tasks: "dietary,meal_plan" };
    let failPut = true;
    routeApi({
      "PUT /api/me/meal-plan": () => {
        if (failPut) throw new Error("meal_plan_locked");
        return plan;
      },
    });
    await renderMobile(<ProfileTasksScreen />);
    await act(async () =>
      fireEvent(await screen.findByLabelText("noRestrictions"), "valueChange", true),
    );
    await screen.findByLabelText(label(lunch));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "save" })));
    expect(await screen.findByText("mealPlanSaveError")).toBeTruthy();
    expect(mockMeContext.refetch).toHaveBeenCalled();

    failPut = false;
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "retry" })));
    const calls = (method: string, path: string) =>
      mockApiFetch.mock.calls.filter(([p, init]) => p === path && init?.method === method);
    expect(calls("PATCH", "/api/me")).toHaveLength(1);
    expect(calls("PUT", "/api/me/meal-plan")).toHaveLength(2);
    expect(mockBack).toHaveBeenCalled();
  });

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
