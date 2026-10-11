/**
 * #966 (H38, H59): a queue or schedule push notification refreshes the Live
 * Activities from the API, debounced with the app's other triggers, in the
 * foreground (received or tapped) and, on iOS, from the background task.
 */
import { renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";

jest.mock("./sync", () => ({
  reconcileLiveActivities: jest.fn(async () => []),
  registerLiveActivityDevice: jest.fn(async () => undefined),
  signOutLiveActivities: jest.fn(async () => undefined),
}));
jest.mock("./host", () => ({ liveActivityHost: { platform: "ios" } }));
jest.mock("./apply", () => ({ applyAndroidLiveUpdate: jest.fn() }));
jest.mock("@/lib/server-events", () => ({ subscribeToServerEvent: () => () => undefined }));
jest.mock("@/lib/sign-out-events", () => ({ registerSignOutListener: () => () => undefined }));
jest.mock("expo-notifications", () => ({ registerTaskAsync: jest.fn(async () => null) }));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));

import { handleBackgroundLiveActivityPush } from "./background-task";
import { isLiveActivityPush, notifyLiveActivityPush, pushCategory } from "./push-refresh";
import { reconcileLiveActivities } from "./sync";
import { useLiveActivities } from "./use-live-activities";

const reconcile = reconcileLiveActivities as jest.Mock;

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("push-triggered Live Activity refresh (#966)", () => {
  beforeEach(() => reconcile.mockClear());

  it("reads the category wherever the delivery path puts it", () => {
    expect(pushCategory({ category: "queue" })).toBe("queue");
    expect(pushCategory({ body: { category: "schedule:4" } })).toBe("schedule:4");
    expect(pushCategory({ dataString: JSON.stringify({ category: "queue" }) })).toBe("queue");
    expect(pushCategory({ body: "not json" })).toBeUndefined();
    expect(pushCategory(null)).toBeUndefined();

    expect(isLiveActivityPush({ category: "queue" })).toBe(true);
    expect(isLiveActivityPush({ category: "schedule:12" })).toBe(true);
    expect(isLiveActivityPush({ category: "queue.staff" })).toBe(false);
    expect(isLiveActivityPush({ category: "application" })).toBe(false);
  });

  it("debounces received pushes into one sync and ignores unrelated ones", async () => {
    jest.useFakeTimers();
    try {
      const hook = await renderHook(() =>
        useLiveActivities({ signedIn: true, userId: 7, language: "en" }),
      );
      await flush();
      // The sign-in reconcile.
      expect(reconcile).toHaveBeenCalledTimes(1);

      notifyLiveActivityPush({ category: "application" });
      jest.advanceTimersByTime(2_000);
      expect(reconcile).toHaveBeenCalledTimes(1);

      // A call: the notification and its tap arrive together.
      notifyLiveActivityPush({ category: "queue", template: "queue.called" });
      notifyLiveActivityPush({ category: "queue", template: "queue.called" });
      jest.advanceTimersByTime(999);
      expect(reconcile).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(reconcile).toHaveBeenCalledTimes(2);

      await hook.unmount();
      notifyLiveActivityPush({ category: "queue" });
      jest.advanceTimersByTime(2_000);
      expect(reconcile).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("refreshes from the iOS background task only while the app is not active", async () => {
    // The jest preset mocks `currentState`; pin it like a device would report it.
    const original = Object.getOwnPropertyDescriptor(AppState, "currentState");
    const setState = (value: string) =>
      Object.defineProperty(AppState, "currentState", {
        value,
        configurable: true,
        writable: true,
      });
    setState("background");
    try {
      await expect(handleBackgroundLiveActivityPush({ body: { category: "queue" } })).resolves.toBe(
        true,
      );
      expect(reconcile).toHaveBeenCalledTimes(1);

      await expect(
        handleBackgroundLiveActivityPush({ body: { category: "project" } }),
      ).resolves.toBe(false);

      // In the foreground the received listener refreshes, debounced.
      setState("active");
      await expect(handleBackgroundLiveActivityPush({ body: { category: "queue" } })).resolves.toBe(
        false,
      );
      expect(reconcile).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(AppState, "currentState", original);
    }
  });
});
