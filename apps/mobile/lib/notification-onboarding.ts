import { channelEnabled, emailLocked } from "@hackos/shared/notification-channels";
import { apiFetch } from "./api";
import type { NotificationPreferences } from "./notification-preferences";
import { isScannerPath } from "./profile-tasks";
import { registerSignOutListener } from "./sign-out-events";
import type { Me } from "./types";

/**
 * H51: the first-run channel prompt is shown at most once per signed-in
 * account while the app process lives; closing it is an in-memory deferral, so
 * it returns after a restart until the person answers it (on any device).
 */
const handledUserIds = new Set<number>();

registerSignOutListener(() => handledUserIds.clear());

export function markNotificationOnboardingHandled(userId: number): void {
  handledUserIds.add(userId);
}

/** Test seam: forget deferrals as a process restart would. */
export function resetNotificationOnboardingHandled(): void {
  handledUserIds.clear();
}

export const NOTIFICATION_ONBOARDING_PATH = "/notification-onboarding";

/** Categories whose email the prompt asks about. */
export const ONBOARDING_CATEGORIES = ["queue", "schedule", "challenge"] as const;

export function shouldPresentNotificationOnboarding({
  me,
  offline,
  navigationReady,
  sessionPending,
  pathname,
  profileTasksPending,
}: {
  me: Me | null;
  offline: boolean;
  navigationReady: boolean;
  sessionPending: boolean;
  pathname: string;
  /** The profile-tasks sheet is due; it goes first. */
  profileTasksPending: boolean;
}): boolean {
  if (!me || offline || !navigationReady || sessionPending) return false;
  if (!me.hasEventAccess || me.accountState !== "active") return false;
  if (!me.notificationOnboardingRequired || profileTasksPending) return false;
  if (handledUserIds.has(me.id)) return false;
  if (pathname === "/" || pathname === NOTIFICATION_ONBOARDING_PATH) return false;
  return !isScannerPath(pathname);
}

function channelState(prefs: NotificationPreferences) {
  return {
    mandatoryCategories: prefs.mandatoryCategories,
    emailOptInCategories: prefs.emailOptInCategories ?? [],
    hasPushDevice: prefs.hasPushDevice ?? true,
    overrides: prefs.overrides,
  };
}

/** Email as it reaches the person today, per onboarding category. */
export function onboardingEmailDraft(prefs: NotificationPreferences): Record<string, boolean> {
  const state = channelState(prefs);
  return Object.fromEntries(
    ONBOARDING_CATEGORIES.map((category) => [category, channelEnabled(state, category, "email")]),
  );
}

export function onboardingEmailLocked(prefs: NotificationPreferences, category: string): boolean {
  return emailLocked(channelState(prefs), category);
}

/** Stores only the choices that differ from today's behavior and marks the account onboarded. */
export function completeNotificationOnboarding(
  prefs: NotificationPreferences,
  draft: Record<string, boolean>,
): Promise<NotificationPreferences> {
  const current = onboardingEmailDraft(prefs);
  const state = channelState(prefs);
  const preferences = ONBOARDING_CATEGORIES.filter(
    (category) => !emailLocked(state, category) && draft[category] !== current[category],
  ).map((category) => ({
    category,
    channel: "email" as const,
    enabled: draft[category] === true,
  }));
  return apiFetch<NotificationPreferences>("/api/me/notification-preferences/onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
}
