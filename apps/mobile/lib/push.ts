import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiFetch, getCurrentSessionCookie } from "./api";
import { registerSignOutListener } from "./sign-out-events";

let registeredToken: { token: string; userId: number; sessionCookie: string } | null = null;

/** The Expo push token this device registered for the signed-in account, if any. */
export function getRegisteredPushToken(userId: number): string | null {
  return registeredToken?.userId === userId ? registeredToken.token : null;
}
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
  registeredToken = { token, userId, sessionCookie: getCurrentSessionCookie() };
}

/**
 * Sign-out removes this device's token so notices that default to email for
 * people without a device (queue calls above all) go back to email instead of
 * a phone nobody is signed in on. Goes out with the session that registered
 * it, before the sign-out flow revokes that session.
 */
registerSignOutListener(async () => {
  const current = registeredToken;
  registeredToken = null;
  if (!current) return;
  await apiFetch("/api/me/push-tokens/unregister", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: current.token }),
    ...(current.sessionCookie ? { sessionCookie: current.sessionCookie } : {}),
  }).catch(() => undefined);
});
