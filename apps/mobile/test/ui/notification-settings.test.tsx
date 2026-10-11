import { act, render, screen, userEvent } from "@testing-library/react-native";
import type { ScheduleItem } from "@/lib/schedule";

const mockPush = jest.fn();
const mockSchedule: { data: ScheduleItem[] } = { data: [] };
const mockSubscribed = new Set<number>();
const mockToggleEntry = jest.fn((item: ScheduleItem) => {
  if (mockSubscribed.has(item.id)) mockSubscribed.delete(item.id);
  else mockSubscribed.add(item.id);
});

jest.mock("expo-router", () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("expo-router/stack", () => ({ __esModule: true, default: { Screen: () => null } }));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: () => "#000000" }),
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/announcement-manage-view", () => ({ ManageAnnouncementsView: () => null }));
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/router-tabs-inset", () => ({
  useRouterTabBarBottomInset: () => 0,
  useRouterTabBarScrollBottomInset: () => 0,
}));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { capabilities: [] } }) }));
jest.mock("@/lib/use-cached-api", () => ({
  useCachedApi: () => ({
    data: mockSchedule.data,
    loading: false,
    error: null,
    staleSince: null,
    load: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock("@/lib/use-notification-preferences", () => ({
  useNotificationPreferences: () => ({
    prefs: { overrides: [] },
    channels: ["in_app", "email", "push"],
    enabledFor: () => true,
    toggle: jest.fn(),
    load: jest.fn().mockResolvedValue(undefined),
    retry: jest.fn(),
    loading: false,
    error: null,
    actionError: null,
    savingKey: null,
    staleSince: null,
  }),
}));
jest.mock("@/lib/use-schedule-notifications", () => ({
  itemCategory: (id: number) => `schedule:${id}`,
  kindCategory: (kind: string) => `schedule:type:${kind}`,
  useScheduleNotifications: () => ({
    ready: true,
    error: null,
    savingKey: null,
    load: mockLoadNotifications,
    retry: jest.fn(),
    isEntrySubscribed: (item: ScheduleItem) => mockSubscribed.has(item.id),
    categoryState: () => "off",
    toggleCategory: jest.fn(),
    toggleEntry: mockToggleEntry,
  }),
}));
const mockLoadNotifications = jest.fn().mockResolvedValue(undefined);

import { NotificationCategoryScreen } from "@/components/notification-settings-screen";
import { ReminderPickerScreen } from "@/components/reminders-view";
import { renderMobile } from "./render";

function activity(id: number, hour: number, type = "talk"): ScheduleItem {
  const start = new Date(Date.now() + 86_400_000);
  start.setHours(hour, 0, 0, 0);
  return {
    id,
    title: `Activity ${id}`,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
    type,
    location: null,
  } as unknown as ScheduleItem;
}

function reminderSwitches() {
  return screen.queryAllByLabelText(/^Reminder on for /);
}

beforeEach(() => {
  mockPush.mockClear();
  mockToggleEntry.mockClear();
  mockSubscribed.clear();
  mockSchedule.data = [1, 2, 3, 4, 5].map((id) => activity(id, 8 + id, id % 2 ? "talk" : "meal"));
});

describe("Activity reminders settings (H59)", () => {
  it("orders channels, then bulk switches by type, then the reminders coming up", async () => {
    await renderMobile(<NotificationCategoryScreen category="schedule" />);

    const headers = (await screen.findAllByRole("header")).map((node) => node.props.children);
    expect(headers).toEqual(["Show notifications", "By activity type", "Coming up"]);
  });

  it("caps Coming up and opens the full list from See all", async () => {
    for (const id of [1, 2, 3, 4, 5]) mockSubscribed.add(id);
    await renderMobile(<NotificationCategoryScreen category="schedule" />);

    await screen.findByText("Coming up");
    expect(reminderSwitches()).toHaveLength(3);
    await userEvent.press(screen.getByRole("button", { name: "See all, 5" }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/others/reminders/[kind]",
      params: { kind: "all", subscribed: "1" },
    });
    expect(screen.getByRole("button", { name: "Add an activity" })).toBeTruthy();
  });

  it("omits See all when every reminder fits", async () => {
    mockSubscribed.add(2);
    await renderMobile(<NotificationCategoryScreen category="schedule" />);

    await screen.findByText("Coming up");
    expect(reminderSwitches()).toHaveLength(1);
    expect(screen.queryByText("See all")).toBeNull();
  });

  it("keeps a reminder switched off in the full list until the person leaves", async () => {
    mockSubscribed.add(1);
    mockSubscribed.add(4);
    // Plain render so rerender keeps the same tree (and the screen's state).
    const view = await render(<ReminderPickerScreen kind="all" subscribedOnly />);

    expect(reminderSwitches()).toHaveLength(2);
    expect(screen.queryByText("Activity 2")).toBeNull();

    mockSubscribed.delete(4);
    await act(() => view.rerender(<ReminderPickerScreen kind="all" subscribedOnly />));
    expect(screen.getByText("Activity 4")).toBeTruthy();
    expect(screen.getByLabelText("Reminder off for Activity 4")).toBeTruthy();
  });

  it("centers every switch in its row and keeps times on one line", async () => {
    mockSubscribed.add(5);
    await renderMobile(<NotificationCategoryScreen category="schedule" />);

    await screen.findByText("Coming up");
    const switches = screen.getAllByRole("switch");
    // Channels (3), activity types (2) and the one reminder.
    expect(switches).toHaveLength(6);
    for (const toggle of switches) {
      expect(toggle).toHaveStyle({ alignSelf: "center" });
    }
    expect(screen.getByText("01:00 PM").props.numberOfLines).toBe(1);
  });
});
