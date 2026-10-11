import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { applyAndroidLiveUpdate } from "./apply";
import { parseAndroidLiveUpdateMessage } from "./model";

/**
 * Android Live Updates (#966) arrive as data-only Expo pushes. This task runs
 * them through the same renderer whether the app is foregrounded, backgrounded
 * or killed; it must be defined at module scope of the entry file (index.ts)
 * so a headless launch registers it before the payload is delivered.
 */
export const LIVE_UPDATE_TASK = "hackos-live-update";

/** Shared by the task and the foreground received listener; idempotent per state. */
export async function handleLiveUpdatePayload(data: unknown): Promise<boolean> {
  const message = parseAndroidLiveUpdateMessage(data);
  if (!message) return false;
  await applyAndroidLiveUpdate(message);
  return true;
}

if (Platform.OS === "android") {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    LIVE_UPDATE_TASK,
    async ({ data }) => {
      if (!data || "actionIdentifier" in data) return;
      try {
        await handleLiveUpdatePayload(data.data);
      } catch {
        // A failed render must not crash the headless task; the next push retries.
      }
    },
  );
  void Notifications.registerTaskAsync(LIVE_UPDATE_TASK).catch(() => undefined);
}
