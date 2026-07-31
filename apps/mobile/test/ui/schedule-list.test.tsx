import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: jest.fn(),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: [] } }),
}));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        scheduleShowMore: "Show more",
        scheduleShowLess: "Show less",
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
    type: "meal",
    startsAt: "2026-07-04T12:00:00.000Z",
    endsAt: "2026-07-04T13:00:00.000Z",
  },
  {
    id: 2,
    title: "Check-in",
    description: "Mesa 1",
    location: null,
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
  it("collapses long entries and expands them in place", async () => {
    await renderMobile(<ScheduleScreen />);

    const showMore = await screen.findByLabelText("Show more");
    expect(screen.getByText(LONG_DESCRIPTION).props.numberOfLines).toBe(2);

    fireEvent.press(showMore);

    expect(await screen.findByLabelText("Show less")).toBeTruthy();
    expect(screen.getByText(LONG_DESCRIPTION).props.numberOfLines).toBeUndefined();
    // Expanding must not navigate away from the list.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps the type pill on the bell's centre line", async () => {
    await renderMobile(<ScheduleScreen />);

    // StatusPill defaults to alignSelf "flex-start", which floats it (and the
    // bell it sits beside) off the title's centre line on multi-line titles.
    const pill = await screen.findByText("Meal");
    const style = StyleSheet.flatten(pill.parent?.props.style);
    expect(style.alignSelf).toBe("center");
  });

  it("leaves short entries without an expand affordance", async () => {
    await renderMobile(<ScheduleScreen />);

    await screen.findByText("Check-in");
    expect(screen.queryAllByLabelText("Show more")).toHaveLength(1);
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
