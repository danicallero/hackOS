import type { LiveActivityKind, MyLiveActivities } from "@hackos/shared/live-activities";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { ApiError, apiFetch, getCurrentSessionCookie } from "@/lib/api";
import { applyDesiredActivities, endAllActivities, markDismissalReported } from "./apply";
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
 * activities, H59 attendee activities, H19 deadline, H22 accreditation
 * desk). The API computes every state (see docs/live-activities.md);
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
/**
 * Bumped on sign-in and sign-out: a reconcile that started under an earlier
 * session must not paint its (possibly another account's) state afterwards.
 */
let generation = 0;
/** Reconciles overlap (foreground, events, timers); an older response never overwrites a newer one. */
let reconcileSeq = 0;
let appliedSeq = 0;
/** False until the server has this device's current registration (retried on the next reconcile). */
let deviceSynced = false;
/** The API answered 404: it predates the module. Stay quiet until the next sign-in. */
let apiMissing = false;
/** `key@phase` dismissal reports in flight, so overlapping reconciles send one. */
const reportingDismissals = new Set<string>();
/** Key → per-activity APNs token the API already has. */
const sessionTokens = new Map<string, string>();

// Subscribed at import (app launch): iOS may deliver the push-to-start token
// before anyone signs in, and the event is not replayed for late listeners.
subscribePushToStartToken((token) => {
  if (token === pushToStartToken) return;
  pushToStartToken = token;
  if (!registeredCookie) return;
  void readLiveActivityState().then((state) => syncDevice(state.enabled).catch(() => undefined));
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

function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
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
  // Turning delivery off needs no token (omitted fields keep their value).
  if (os === "android" && enabled) {
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
 * Sends this device's registration. A failure leaves `deviceSynced` false so
 * the next reconcile (foreground, event) retries it: otherwise a sign-in made
 * offline, or a failed opt-out, would leave the server's delivery wrong.
 */
async function syncDevice(enabled: boolean): Promise<void> {
  deviceSynced = false;
  try {
    await putDevice(enabled);
    deviceSynced = true;
  } catch (error) {
    if (isMissingEndpoint(error)) apiMissing = true;
    throw error;
  }
}

/**
 * Registers (or refreshes) this device after sign-in, on a language change
 * and whenever iOS rotates the push-to-start token.
 */
export async function registerLiveActivityDevice(nextLanguage: string | null): Promise<void> {
  if (!platform() || !liveActivityHost.supported()) return;
  language = nextLanguage;
  generation += 1;
  apiMissing = false;
  const state = await readLiveActivityState();
  registeredCookie = getCurrentSessionCookie() || null;
  await syncDevice(state.enabled);
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

async function unregisterSession(kind: LiveActivityKind, subject: string, phase?: string) {
  sessionTokens.delete(liveActivityKey(kind, subject));
  await apiFetch("/api/me/live-activities/sessions", {
    method: "DELETE",
    headers: JSON_HEADERS,
    body: JSON.stringify({ deviceId: await liveActivityDeviceId(), kind, subject, phase }),
  });
}

async function apply(desired: DesiredActivity[]): Promise<DesiredActivity[]> {
  lastDesired = desired;
  const result = await applyDesiredActivities(desired);
  // A swiped-away activity: tell the server not to start it again in the
  // phase it was dismissed in. Kept until the API accepts it (a dismissal
  // recorded while offline or headless is reported on a later sync).
  for (const [key, phase] of Object.entries(result.dismissed)) {
    const item = desired.find(
      (candidate) => liveActivityKey(candidate.kind, candidate.subject) === key,
    );
    const report = `${key}@${phase}`;
    if (!item || reportingDismissals.has(report)) continue;
    reportingDismissals.add(report);
    void unregisterSession(item.kind, item.subject, phase)
      .then(() => markDismissalReported(key, phase))
      .catch(() => undefined)
      .finally(() => reportingDismissals.delete(report));
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
  if (!platform() || !liveActivityHost.supported() || apiMissing) return [];
  const startedIn = generation;
  if (registeredCookie && !deviceSynced) {
    await syncDevice((await readLiveActivityState()).enabled).catch(() => undefined);
    if (apiMissing) return [];
  }
  const seq = ++reconcileSeq;
  let response: MyLiveActivities;
  try {
    // `deviceId` makes the server apply this device's `maxConcurrent` cut
    // with the sessions it already shows (hysteresis, displacement by rank).
    const deviceId = encodeURIComponent(await liveActivityDeviceId());
    response = await apiFetch<MyLiveActivities>(`/api/me/live-activities?deviceId=${deviceId}`);
  } catch (error) {
    if (isMissingEndpoint(error)) apiMissing = true;
    throw error;
  }
  // Signed out (or into another account) meanwhile, or a newer read already
  // applied: painting this response would resurrect stale surfaces.
  if (startedIn !== generation) return [];
  if (seq < appliedSeq) return lastDesired;
  appliedSeq = seq;
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
  await syncDevice(enabled);
  if (enabled) await reconcileLiveActivities().catch(() => undefined);
}

/**
 * Sign-out: stop server delivery to this device and end every local surface.
 * The PUT goes first, with the session that registered the device, because
 * the sign-out flow revokes that session as soon as this promise settles.
 */
export async function signOutLiveActivities(): Promise<void> {
  const cookie = registeredCookie;
  registeredCookie = null;
  generation += 1;
  deviceSynced = false;
  lastDesired = [];
  sessionTokens.clear();
  const disable = cookie ? putDevice(false, cookie).catch(() => undefined) : Promise.resolve();
  await Promise.all([disable, endAllActivities().catch(() => undefined)]);
}
