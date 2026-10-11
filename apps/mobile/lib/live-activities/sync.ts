import type { LiveActivityKind, MyLiveActivities } from "@hackos/shared/live-activities";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { apiFetch, getCurrentSessionCookie } from "@/lib/api";
import { applyDesiredActivities, endAllActivities } from "./apply";
import { liveActivityHost, subscribePushToStartToken } from "./host";
import {
  type DesiredActivity,
  desiredActivities,
  liveActivityKey,
  withScannedIncrement,
} from "./model";
import { liveActivityDeviceId, readLiveActivityState, updateLiveActivityState } from "./store";

/**
 * Foreground Live Activity orchestration (#966; H38 queue, H25/H26 staff
 * activities). The API computes every state (see docs/live-activities.md);
 * this module registers the device and its tokens, then mirrors
 * `GET /api/me/live-activities` onto the system surfaces through the platform
 * host. Everything is best effort: a failure never blocks the app.
 */

const JSON_HEADERS = { "content-type": "application/json" };

let language: string | null = null;
let pushToStartToken: string | null = null;
/** Session that registered this device; sign-out has already cleared the live one. */
let registeredCookie: string | null = null;
let lastDesired: DesiredActivity[] = [];
/** Key → per-activity APNs token the API already has. */
const sessionTokens = new Map<string, string>();

// Subscribed at import (app launch): iOS may deliver the push-to-start token
// before anyone signs in, and the event is not replayed for late listeners.
subscribePushToStartToken((token) => {
  if (token === pushToStartToken) return;
  pushToStartToken = token;
  if (!registeredCookie) return;
  void readLiveActivityState().then((state) => putDevice(state.enabled).catch(() => undefined));
});

function platform(): "ios" | "android" | null {
  return liveActivityHost.platform;
}

async function expoPushToken(): Promise<string | undefined> {
  // Android Live Updates ride the ordinary Expo push channel; `lib/push.ts`
  // owns the permission prompt, so only read the token when already granted.
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== "granted") return undefined;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return data;
  } catch {
    return undefined;
  }
}

async function putDevice(enabled: boolean, sessionCookie?: string): Promise<void> {
  const os = platform();
  if (!os) return;
  const body: Record<string, unknown> = {
    deviceId: await liveActivityDeviceId(),
    platform: os,
    enabled,
  };
  if (language) body.language = language;
  if (os === "ios" && pushToStartToken) body.pushToStartToken = pushToStartToken;
  if (os === "android") {
    const token = await expoPushToken();
    if (token) body.expoPushToken = token;
  }
  await apiFetch("/api/me/live-activities/device", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    ...(sessionCookie ? { sessionCookie } : {}),
  });
}

/**
 * Registers (or refreshes) this device after sign-in, on a language change
 * and whenever iOS rotates the push-to-start token.
 */
export async function registerLiveActivityDevice(nextLanguage: string | null): Promise<void> {
  if (!platform() || !liveActivityHost.supported()) return;
  language = nextLanguage;
  const state = await readLiveActivityState();
  registeredCookie = getCurrentSessionCookie() || null;
  await putDevice(state.enabled);
}

async function registerSessionToken(kind: LiveActivityKind, subject: string, token: string) {
  const key = liveActivityKey(kind, subject);
  if (sessionTokens.get(key) === token) return;
  await apiFetch("/api/me/live-activities/sessions", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      deviceId: await liveActivityDeviceId(),
      kind,
      subject,
      activityPushToken: token,
    }),
  });
  sessionTokens.set(key, token);
}

async function unregisterSession(kind: LiveActivityKind, subject: string) {
  sessionTokens.delete(liveActivityKey(kind, subject));
  await apiFetch("/api/me/live-activities/sessions", {
    method: "DELETE",
    headers: JSON_HEADERS,
    body: JSON.stringify({ deviceId: await liveActivityDeviceId(), kind, subject }),
  });
}

async function apply(desired: DesiredActivity[]): Promise<DesiredActivity[]> {
  lastDesired = desired;
  const result = await applyDesiredActivities(desired);
  // A swiped-away activity: tell the server not to push-start it again.
  for (const key of result.dismissed) {
    const item = desired.find(
      (candidate) => liveActivityKey(candidate.kind, candidate.subject) === key,
    );
    if (item) void unregisterSession(item.kind, item.subject).catch(() => undefined);
  }
  // Every running activity — including ones APNs started — reports its
  // per-activity token so the server can update it.
  if (liveActivityHost.platform === "ios") {
    for (const [, surface] of result.running) {
      const subject = surface.subject ?? (surface.kind === "queue" ? "judging" : null);
      if (!subject) continue;
      const send = (token: string) =>
        void registerSessionToken(surface.kind, subject, token).catch(() => undefined);
      liveActivityHost.onPushToken(surface.id, send);
      const token = await liveActivityHost.pushToken(surface.id);
      if (token) send(token);
    }
  }
  return desired;
}

/** Fetches the server's state and mirrors it. Returns what should be showing. */
export async function reconcileLiveActivities(): Promise<DesiredActivity[]> {
  if (!platform() || !liveActivityHost.supported()) return [];
  const response = await apiFetch<MyLiveActivities>("/api/me/live-activities");
  return apply(desiredActivities(response));
}

/**
 * H25/H26: right after a first-time scan in an activity this device shows,
 * bump its counter locally; the next server state converges it.
 */
export async function bumpActivityScanned(activityId: number): Promise<void> {
  let changed = false;
  const desired = lastDesired.map((item) => {
    if (item.props.kind !== "activity" || item.props.activityId !== activityId) return item;
    if (item.props.phase !== "live") return item;
    changed = true;
    return { ...item, props: withScannedIncrement(item.props) };
  });
  if (changed) await apply(desired).catch(() => undefined);
}

export async function liveActivitiesEnabled(): Promise<boolean> {
  return (await readLiveActivityState()).enabled;
}

/** In-app opt-out (HIG: easy to turn off): the server stops and local ones end now. */
export async function setLiveActivitiesEnabled(enabled: boolean): Promise<void> {
  await updateLiveActivityState((state) => ({ ...state, enabled }));
  if (!enabled) {
    sessionTokens.clear();
    await endAllActivities();
  }
  await putDevice(enabled);
  if (enabled) await reconcileLiveActivities().catch(() => undefined);
}

/** Sign-out: end every local surface and stop server delivery to this device. */
export async function signOutLiveActivities(): Promise<void> {
  const cookie = registeredCookie;
  registeredCookie = null;
  lastDesired = [];
  sessionTokens.clear();
  await endAllActivities().catch(() => undefined);
  if (cookie) await putDevice(false, cookie).catch(() => undefined);
}
