import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({
    addListener: () => () => {},
    isFocused: () => true,
    setOptions: jest.fn(),
  }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("expo-router/stack", () => ({
  __esModule: true,
  default: { Screen: () => null },
}));

jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: jest.fn(),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: [] } }),
}));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => {
    const ReactLib = require("react");
    return ReactLib.createElement(ReactLib.Fragment, null, children);
  },
}));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: ({ children }: { children: unknown }) => {
      const ReactLib = require("react");
      return ReactLib.createElement(ReactLib.Fragment, null, children);
    },
  },
  interpolate: () => 1,
  useAnimatedStyle: (factory: () => unknown) => factory(),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        scheduleReminderOn: "Reminder on",
        scheduleReminderOff: "Reminder off",
        typeMeal: "Meal",
        typeOther: "Other",
      })[key] ?? key,
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    background: "#f5f5f7",
    label: "#171717",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    surface: "#ffffff",
    tertiaryLabel: "#7c7c80",
  },
}));

import ScheduleScreen from "@/app/(tabs)/schedule";
import { apiFetch } from "@/lib/api";
import { renderMobile } from "./render";

const LONG_DESCRIPTION =
  "Comida del sábado en el hall principal: turnos de 30 minutos por equipo, con opciones vegetarianas y sin gluten disponibles en la barra del fondo.";

const items = [
  {
    id: 1,
    title: "Comida Sábado",
    description: LONG_DESCRIPTION,
    location: "Hall",
    audiences: [],
    type: "meal",
    startsAt: "2026-07-04T12:00:00.000Z",
    endsAt: "2026-07-04T13:00:00.000Z",
  },
  {
    id: 2,
    title: "Check-in",
    description: "Mesa 1",
    location: null,
    audiences: [],
    type: "other",
    startsAt: "2026-07-04T15:00:00.000Z",
    endsAt: "2026-07-04T15:30:00.000Z",
  },
];

const emptyPreferences = { channels: ["push"], mandatoryCategories: [], overrides: [] };

/** Stands in for the server: a PUT persists the override the next GET returns. */
function mockApi(initial: { category: string; channel: string; enabled: boolean }[] = []) {
  let overrides = initial;
  (apiFetch as jest.Mock).mockImplementation(
    (path: string, init?: { method?: string; body?: string }) => {
      if (path === "/api/public/activities") return Promise.resolve({ items });
      if (path === "/api/me/notification-preferences") {
        if (init?.method === "PUT") overrides = JSON.parse(init.body ?? "{}").preferences;
        return Promise.resolve({ ...emptyPreferences, overrides });
      }
      return Promise.resolve({});
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi();
});

describe("schedule list (H374)", () => {
  it("clamps a long description instead of expanding in place", async () => {
    await renderMobile(<ScheduleScreen />);

    await screen.findByText(LONG_DESCRIPTION);
    expect(screen.getByText(LONG_DESCRIPTION).props.numberOfLines).toBe(2);
    // There's no in-list expand affordance anymore — the whole card opens the detail view.
    expect(screen.queryByLabelText("Show more")).toBeNull();
  });

  it("keeps the type label centered in its metadata row", async () => {
    await renderMobile(<ScheduleScreen />);

    const pill = await screen.findByText("Meal");
    const style = StyleSheet.flatten(pill.props.style);
    expect(style.alignSelf).toBe("center");
  });

  it("leaves a short description unclamped", async () => {
    await renderMobile(<ScheduleScreen />);

    await screen.findByText("Check-in");
    expect(screen.getByText("Mesa 1").props.numberOfLines).toBeUndefined();
  });

  it("toggles the reminder straight from the list without opening the detail view", async () => {
    await renderMobile(<ScheduleScreen />);

    const bells = await screen.findAllByLabelText("Reminder off");
    fireEvent.press(bells[0]);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/me/notification-preferences",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    const put = (apiFetch as jest.Mock).mock.calls.find((call) => call[1]?.method === "PUT");
    expect(JSON.parse(put[1].body)).toEqual({
      preferences: [{ category: "schedule:1", channel: "push", enabled: true }],
    });
    expect(await screen.findByLabelText("Reminder on")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
