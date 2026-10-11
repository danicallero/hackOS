/**
 * #966 (H38, H25, H59, H19, H22): Notifications → Live Activities. The master
 * row opens the per-kind screen; there each kind has its switch, VoiceOver
 * move actions reorder, and reset appears only for a customized order.
 */
import { fireEvent, screen, userEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
const mockKinds = {
  kinds: [
    { kind: "queue", enabled: true },
    { kind: "attendee_activity", enabled: false },
    { kind: "activity", enabled: true },
  ],
  customOrder: false,
  busyKind: null,
  ordering: false,
  toggle: jest.fn(),
  reorder: jest.fn(),
  resetOrder: jest.fn(),
  load: jest.fn().mockResolvedValue(undefined),
};

jest.mock("expo-router", () => ({
  useFocusEffect: () => undefined,
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("expo-router/stack", () => ({ __esModule: true, default: { Screen: () => null } }));
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#000000" }) }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/announcement-manage-view", () => ({ ManageAnnouncementsView: () => null }));
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/components/reminders-view", () => ({
  ScheduleReminderSections: () => null,
  useScheduleReminders: () => ({
    items: [],
    notifications: { ready: false },
    reload: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { capabilities: [] } }) }));
jest.mock("@/lib/use-notification-preferences", () => ({
  useNotificationPreferences: () => ({
    prefs: { overrides: [] },
    channels: ["push"],
    enabledFor: () => true,
    load: jest.fn().mockResolvedValue(undefined),
    staleSince: null,
  }),
}));
jest.mock("@/lib/live-activities/use-live-activities-setting", () => ({
  useLiveActivitiesSetting: () => ({
    available: true,
    platform: "ios",
    enabled: true,
    busy: false,
    toggle: jest.fn(),
  }),
}));
jest.mock("@/lib/live-activities/use-live-activity-kinds", () => ({
  useLiveActivityKinds: () => mockKinds,
}));

import { LiveActivityKindsScreen, moveKind } from "@/components/live-activity-kinds-screen";
import { NotificationSettingsScreen } from "@/components/notification-settings-screen";
import { renderMobile } from "./render";

beforeEach(() => {
  jest.clearAllMocks();
  mockKinds.customOrder = false;
});

describe("moveKind", () => {
  it("moves one place and clamps at the ends", () => {
    const order = ["queue", "attendee_activity", "activity"] as const;
    expect(moveKind(order, "activity", -1)).toEqual(["queue", "activity", "attendee_activity"]);
    expect(moveKind(order, "queue", -1)).toEqual([...order]);
    expect(moveKind(order, "queue", 2)).toEqual(["attendee_activity", "activity", "queue"]);
  });
});

describe("Notifications → Live Activities row", () => {
  it("keeps the device switch and opens the per-kind screen from the label", async () => {
    await renderMobile(<NotificationSettingsScreen />);
    expect(screen.getByRole("switch", { name: "Live Activities" })).toBeTruthy();
    await userEvent.press(screen.getByRole("button", { name: "Live Activities, 2 of 3 on" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/notification-settings/live-activities");
  });
});

describe("LiveActivityKindsScreen", () => {
  it("lists each kind with its switch in the person's order", async () => {
    await renderMobile(<LiveActivityKindsScreen />);
    const switches = screen.getAllByRole("switch");
    expect(switches.map((node) => node.props.accessibilityLabel)).toEqual([
      "Judging queue",
      "Schedule",
      "Meal and activity scanning",
    ]);
    fireEvent(switches[1]!, "valueChange", true);
    expect(mockKinds.toggle).toHaveBeenCalledWith("attendee_activity", true);
    expect(screen.queryByRole("button", { name: "Reset to default order" })).toBeNull();
  });

  it("reorders through the VoiceOver move actions", async () => {
    await renderMobile(<LiveActivityKindsScreen />);
    const handle = screen.getByLabelText("Reorder Schedule");
    expect(handle.props.accessibilityValue).toEqual({ text: "2 of 3" });
    expect(handle.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      "moveUp",
      "moveDown",
    ]);
    fireEvent(handle, "accessibilityAction", { nativeEvent: { actionName: "moveUp" } });
    expect(mockKinds.reorder).toHaveBeenCalledWith(["attendee_activity", "queue", "activity"]);
    // The first kind cannot move up.
    const first = screen.getByLabelText("Reorder Judging queue");
    expect(first.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      "moveDown",
    ]);
  });

  it("offers reset only for a customized order", async () => {
    mockKinds.customOrder = true;
    await renderMobile(<LiveActivityKindsScreen />);
    await userEvent.press(screen.getByRole("button", { name: "Reset to default order" }));
    expect(mockKinds.resetOrder).toHaveBeenCalled();
  });
});
