import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiFetch } from "./api";

let registeredToken: { token: string; userId: number } | null = null;
let registration: Promise<void> | null = null;

/**
 * Registers this device's Expo push token with the API (POST
 * /api/me/push-tokens) so operational notifications — queue calls above all,
 * non-optional per H51 — reach it. Best-effort: permission can be denied, or
 * this can run on a simulator with no push capability; callers should not
 * block sign-in on it.
 */
export async function registerForPushNotifications(userId: number): Promise<void> {
  if (registration) return registration.then(() => registerForPushNotifications(userId));
  registration = registerToken(userId).finally(() => {
    registration = null;
  });
  return registration;
}

async function registerToken(userId: number): Promise<void> {
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

  if (registeredToken?.userId === userId && registeredToken.token === token) return;

  await apiFetch("/api/me/push-tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : undefined,
    }),
  });
  registeredToken = { token, userId };
}
