import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiFetch } from "./api";

/**
 * Registers this device's Expo push token with the API (POST
 * /api/me/push-tokens) so operational notifications — queue calls above all,
 * non-optional per H51 — reach it. Best-effort: permission can be denied, or
 * this can run on a simulator with no push capability; callers should not
 * block sign-in on it.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) return;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );

  await apiFetch("/api/me/push-tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : undefined,
    }),
  });
}
