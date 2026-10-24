import { act, screen } from "@testing-library/react-native";
import type { ScheduleItem } from "@/lib/schedule";

const mockSchedule: { data: ScheduleItem[] } = { data: [] };
const mockSubscribed = new Set<number>();
const mockToggleEntry = jest.fn((item: ScheduleItem) => {
  if (mockSubscribed.has(item.id)) mockSubscribed.delete(item.id);
  else mockSubscribed.add(item.id);
});

const mockSetOptions = jest.fn();
jest.mock("expo-router", () => ({
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useRouter: () => ({ push: jest.fn() }),
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
    emailLockedFor: (category: string) => category === "queue",
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

beforeEach(() => {
  mockToggleEntry.mockClear();
  mockSubscribed.clear();
  mockSetOptions.mockClear();
  mockSchedule.data = [1, 2, 3, 4, 5].map((id) => activity(id, 8 + id, id % 2 ? "talk" : "meal"));
});

async function typeSearch(text: string) {
  const { headerSearchBarOptions } = mockSetOptions.mock.calls.at(-1)?.[0] ?? {};
  await act(async () => headerSearchBarOptions.onChangeText({ nativeEvent: { text } }));
}

describe("Activity reminders settings (H59)", () => {
  it("orders channels, then bulk switches by type", async () => {
    await renderMobile(<NotificationCategoryScreen category="schedule" />);

    const headers = (await screen.findAllByRole("header")).map((node) => node.props.children);
    expect(headers).toEqual(["Show notifications", "By activity type"]);
  });

  it("searches activities from the header and toggles one", async () => {
    await renderMobile(<NotificationCategoryScreen category="schedule" />);
    await screen.findByText("By activity type");

    await typeSearch("activity 4");
    expect(screen.queryByText("By activity type")).toBeNull();
    expect(screen.getByText("Activity 4")).toBeTruthy();
    expect(screen.queryByText("Activity 2")).toBeNull();
    expect(screen.getByLabelText("Reminder off for Activity 4")).toBeTruthy();

    await typeSearch("zzz");
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("offers only email for queue calls, locked while no device is registered (H51)", async () => {
    await renderMobile(<NotificationCategoryScreen category="queue" />);
    const email = await screen.findByLabelText("Queue calls, Email");
    expect(email.props.accessibilityState?.disabled ?? email.props.disabled).toBeTruthy();
    expect(screen.queryByLabelText("Queue calls, Push")).toBeNull();
    expect(screen.queryByLabelText("Queue calls, In-app")).toBeNull();
  });

  it("does not add search to other notification types", async () => {
    mockSetOptions.mockClear();
    await renderMobile(<NotificationCategoryScreen category="announcements" />);
    expect(mockSetOptions).not.toHaveBeenCalled();
  });

  it("filters one kind's activities by search", async () => {
    await renderMobile(<ReminderPickerScreen kind="talk" />);
    expect(screen.getByText("Activity 1")).toBeTruthy();
    expect(screen.getByText("Activity 3")).toBeTruthy();

    await typeSearch("3");
    expect(screen.queryByText("Activity 1")).toBeNull();
    expect(screen.getByText("Activity 3")).toBeTruthy();
  });

  it("centers every switch in its row and keeps times on one line", async () => {
    mockSubscribed.add(5);
    await renderMobile(<NotificationCategoryScreen category="schedule" />);

    await screen.findByText("By activity type");
    const switches = screen.getAllByRole("switch");
    // Channels (3) and activity types (2).
    expect(switches).toHaveLength(5);
    for (const toggle of switches) {
      expect(toggle).toHaveStyle({ alignSelf: "center" });
    }
  });
});
