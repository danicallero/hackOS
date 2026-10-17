const mockScheduled: { identifier: string }[] = [];
const mockCalls = { schedule: [] as unknown[], cancel: [] as string[], put: [] as unknown[] };
let mockPermission = "granted";
let mockApi: Record<string, unknown> = {};
let mockToken: string | null = "ExponentPushToken[me]";

jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  getPermissionsAsync: async () => ({ status: mockPermission }),
  getAllScheduledNotificationsAsync: async () => [...mockScheduled],
  cancelScheduledNotificationAsync: async (identifier: string) => {
    mockCalls.cancel.push(identifier);
    const index = mockScheduled.findIndex((request) => request.identifier === identifier);
    if (index >= 0) mockScheduled.splice(index, 1);
  },
  scheduleNotificationAsync: async (request: { identifier: string }) => {
    mockCalls.schedule.push(request);
    mockScheduled.push({ identifier: request.identifier });
  },
}));
jest.mock("./api", () => ({
  apiFetch: async (path: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      mockCalls.put.push({ path, body: JSON.parse(init.body ?? "null") });
      return { status: true };
    }
    const value = mockApi[path];
    if (value instanceof Error) throw value;
    return value;
  },
}));
jest.mock("./push", () => ({
  registerForPushNotifications: async () => undefined,
  getRegisteredPushToken: () => mockToken,
}));
jest.mock("./event-time", () => ({ formatEventTime: () => "10:00" }));

import {
  clearLocalReminders,
  LOCAL_REMINDER_PREFIX,
  MAX_LOCAL_REMINDERS,
  planLocalReminders,
  syncLocalReminders,
} from "./local-reminders";
import type { NotificationPreferences } from "./notification-preferences";
import type { ScheduleItem } from "./schedule";

const NOW = Date.parse("2026-10-17T08:00:00.000Z");
const minutes = (count: number) => count * 60_000;

function item(
  id: number,
  startsInMinutes: number,
  extra: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id,
    title: `Activity ${id}`,
    description: null,
    location: null,
    type: "talk",
    startsAt: new Date(NOW + minutes(startsInMinutes)).toISOString(),
    endsAt: new Date(NOW + minutes(startsInMinutes + 30)).toISOString(),
    audiences: ["participant"],
    primaryLanguage: "en",
    titleI18n: {},
    descriptionI18n: {},
    ...extra,
  };
}

function prefs(...categories: [string, boolean][]): NotificationPreferences {
  return {
    channels: ["in_app", "email", "push"],
    mandatoryCategories: [],
    overrides: categories.map(([category, enabled]) => ({ category, channel: "push", enabled })),
  };
}

const settings = { enabled: true, leadMinutes: 15 };
const plan = (items: ScheduleItem[], preferences: NotificationPreferences, override = {}) =>
  planLocalReminders({
    items,
    prefs: preferences,
    settings: { ...settings, ...override },
    nowMs: NOW,
    language: "en",
    bodyFor: () => "body",
  });

describe("planLocalReminders (H51, H59)", () => {
  it("reminds only subscribed upcoming items, at start minus the lead", () => {
    const planned = plan(
      [item(1, 60), item(2, 90), item(3, 120)],
      prefs(["schedule:1", true], ["schedule:type:talk", true], ["schedule:3", false]),
    );
    expect(planned.map((reminder) => reminder.id)).toEqual([1, 2]);
    expect(planned[0]).toMatchObject({
      identifier: `${LOCAL_REMINDER_PREFIX}1`,
      fireAtMs: NOW + minutes(45),
      startsAtMs: NOW + minutes(60),
      title: "Activity 1",
    });
  });

  it("plans nothing when the event switched reminders off", () => {
    expect(plan([item(1, 60)], prefs(["schedule:1", true]), { enabled: false })).toEqual([]);
  });

  it("skips drafts, started items and reminders already inside the lead window", () => {
    const planned = plan(
      [item(1, 60, { visibility: "hidden" }), item(2, -5), item(3, 10), item(4, 16)],
      prefs(["schedule:type:talk", true]),
    );
    expect(planned.map((reminder) => reminder.id)).toEqual([4]);
  });

  it("keeps the soonest reminders within the iOS pending-notification budget", () => {
    const items = Array.from({ length: MAX_LOCAL_REMINDERS + 10 }, (_, index) =>
      item(index + 1, 60 + (MAX_LOCAL_REMINDERS + 10 - index)),
    );
    const planned = plan(items, prefs(["schedule:type:talk", true]));
    expect(planned).toHaveLength(MAX_LOCAL_REMINDERS);
    expect(planned[0]?.fireAtMs).toBeLessThan(planned[planned.length - 1]?.fireAtMs ?? 0);
  });
});

describe("syncLocalReminders", () => {
  const t = () => "Starts at 10:00";
  const userId = 7;
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    mockScheduled.length = 0;
    mockCalls.schedule.length = 0;
    mockCalls.cancel.length = 0;
    mockCalls.put.length = 0;
    mockPermission = "granted";
    mockToken = "ExponentPushToken[me]";
    mockApi = {
      "/api/public/activities": { items: [item(1, 60), item(2, 90)] },
      "/api/me/notification-preferences": prefs(["schedule:1", true]),
      "/api/me/reminder-settings": settings,
    };
  });
  afterEach(() => jest.restoreAllMocks());

  it("schedules the plan, replaces stale reminders and reports what it covers", async () => {
    mockScheduled.push({ identifier: `${LOCAL_REMINDER_PREFIX}99` }, { identifier: "other" });
    await syncLocalReminders({ userId, language: "en", t });
    expect(mockCalls.cancel).toEqual([`${LOCAL_REMINDER_PREFIX}99`]);
    expect(mockCalls.schedule).toHaveLength(1);
    expect(mockCalls.schedule[0]).toMatchObject({
      identifier: `${LOCAL_REMINDER_PREFIX}1`,
      content: { title: "Activity 1", data: { category: "schedule:1", localReminder: true } },
    });
    expect(mockCalls.put).toEqual([
      {
        path: "/api/me/local-reminders",
        body: {
          token: "ExponentPushToken[me]",
          leadMinutes: 15,
          items: [{ id: 1, startsAtMs: NOW + minutes(60) }],
        },
      },
    ]);
  });

  it("keeps existing reminders when the server cannot be reached", async () => {
    mockScheduled.push({ identifier: `${LOCAL_REMINDER_PREFIX}1` });
    mockApi["/api/me/reminder-settings"] = new Error("offline");
    await syncLocalReminders({ userId, language: "en", t });
    expect(mockCalls.cancel).toEqual([]);
    expect(mockCalls.schedule).toEqual([]);
    expect(mockCalls.put).toEqual([]);
  });

  it("does not report coverage without a registered push token", async () => {
    mockToken = null;
    await syncLocalReminders({ userId, language: "en", t });
    expect(mockCalls.schedule).toHaveLength(1);
    expect(mockCalls.put).toEqual([]);
  });

  it("clears every local reminder when notifications are not permitted", async () => {
    mockPermission = "denied";
    mockScheduled.push({ identifier: `${LOCAL_REMINDER_PREFIX}1` });
    await syncLocalReminders({ userId, language: "en", t });
    expect(mockCalls.cancel).toEqual([`${LOCAL_REMINDER_PREFIX}1`]);
    expect(mockCalls.schedule).toEqual([]);
  });

  it("clearLocalReminders removes only this feature's notifications", async () => {
    mockScheduled.push({ identifier: `${LOCAL_REMINDER_PREFIX}1` }, { identifier: "other" });
    await clearLocalReminders();
    expect(mockScheduled).toEqual([{ identifier: "other" }]);
  });
});
