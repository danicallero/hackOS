import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { AppState, Platform } from "react-native";
import { applyAndroidLiveUpdate } from "./apply";
import { parseAndroidLiveUpdateMessage } from "./model";
import { isLiveActivityPush } from "./push-refresh";
import { reconcileLiveActivities } from "./sync";

/**
 * The background notification task (#966); it must be defined at module
 * scope of the entry file (index.ts) so a headless launch registers it before
 * the payload is delivered.
 *
 * - Android: Live Updates arrive as data-only Expo pushes, rendered through
 *   the same renderer whether the app is foregrounded, backgrounded or killed.
 * - iOS: a queue or schedule notification is sent `content-available`, which
 *   wakes a backgrounded (not force-quit) app; the task then refreshes the
 *   Live Activities from the API in case their APNs update is late.
 */
export const LIVE_UPDATE_TASK = "hackos-live-update";

/** Shared by the task and the foreground received listener; idempotent per state. */
export async function handleLiveUpdatePayload(data: unknown): Promise<boolean> {
  const message = parseAndroidLiveUpdateMessage(data);
  if (!message) return false;
  await applyAndroidLiveUpdate(message);
  return true;
}

/**
 * iOS: refreshes the Live Activities for a queue or schedule push received in
 * the background. In the foreground the received listener does it instead,
 * debounced with the app's other triggers.
 */
export async function handleBackgroundLiveActivityPush(data: unknown): Promise<boolean> {
  if (AppState.currentState === "active" || !isLiveActivityPush(data)) return false;
  await reconcileLiveActivities();
  return true;
}

if (Platform.OS === "android" || Platform.OS === "ios") {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    LIVE_UPDATE_TASK,
    async ({ data }) => {
      if (!data || "actionIdentifier" in data) return;
      try {
        if (Platform.OS === "android") await handleLiveUpdatePayload(data.data);
        else await handleBackgroundLiveActivityPush(data.data);
      } catch {
        // A failed render must not crash the headless task; the next push retries.
      }
    },
  );
  void Notifications.registerTaskAsync(LIVE_UPDATE_TASK).catch(() => undefined);
}
