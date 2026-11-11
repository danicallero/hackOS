import type {
  OnboardingAction,
  OnboardingStep,
  ResolvedOnboardingStep,
} from "@hackos/shared/onboarding";
import { api } from "./api";
import type { Me } from "./types";

/** GET /api/me/onboarding. The server resolves every step; the client never re-derives status. */
export interface OnboardingState {
  eventKey: string;
  revision: number;
  steps: ResolvedOnboardingStep[];
  /** The organizer's localized welcome text, when the API serves it to attendees. */
  welcomeMessage?: Partial<Record<"es" | "gl" | "en", string>> | null;
}

export const ONBOARDING_PATH = "/onboarding";
/** The signed-in home (nav "Inicio"); `/` is the public landing page. */
export const APP_HOME_PATH = "/event";

export const readOnboarding = async (signal?: AbortSignal): Promise<OnboardingState> => {
  const state = await api.get<OnboardingState>("/api/me/onboarding", { signal });
  // An unexpected body (no journey) reads as an empty one rather than crashing the shell.
  return { ...state, steps: Array.isArray(state?.steps) ? state.steps : [] };
};

export const decideStep = (step: OnboardingStep, action: OnboardingAction, deferUntil?: string) =>
  api.put<OnboardingState | undefined>(`/api/me/onboarding/${step}`, {
    action,
    ...(deferUntil ? { deferUntil } : {}),
  });

/** Steps still waiting for an answer, in server order. */
export function pendingSteps(state: OnboardingState | null): ResolvedOnboardingStep[] {
  return state?.steps.filter((step) => step.status === "pending") ?? [];
}

export function hasPendingOnboarding(state: OnboardingState | null): boolean {
  return pendingSteps(state).length > 0;
}

/**
 * The step to show: the requested one when it exists, otherwise the first
 * pending step, otherwise the last step (completion). Resumable after reload
 * because the server owns the statuses.
 */
export function currentStep(
  state: OnboardingState,
  requested: string | null,
): ResolvedOnboardingStep | null {
  const found = state.steps.find((step) => step.step === requested);
  if (found) return found;
  return pendingSteps(state)[0] ?? state.steps[state.steps.length - 1] ?? null;
}

/** The step after `step` in server order, whatever its status. Null at the end. */
export function stepAfter(state: OnboardingState, step: OnboardingStep): OnboardingStep | null {
  const index = state.steps.findIndex((item) => item.step === step);
  return index >= 0 ? (state.steps[index + 1]?.step ?? null) : null;
}

/** Tomorrow's local morning: a "later" answer returns to the person the next day. */
export function deferUntilTomorrow(now: Date = new Date()): string {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

/** The steps that are real questions (progress dots); welcome and completion frame them. */
export const FRAME_STEPS: readonly OnboardingStep[] = ["welcome", "completion"];

const SESSION_FLAG = "hackos.onboardingOffered.";

/** The app offers the flow on the first page of each sign-in session, never as a gate. */
export function wasOnboardingOffered(userId: number): boolean {
  try {
    return window.sessionStorage.getItem(`${SESSION_FLAG}${userId}`) === "1";
  } catch {
    return false;
  }
}

/** A new sign-in or sign-out starts a new offer: it opens again on the next entry. */
export function resetOnboardingOffered(): void {
  try {
    for (const key of Object.keys(window.sessionStorage))
      if (key.startsWith(SESSION_FLAG)) window.sessionStorage.removeItem(key);
  } catch {
    /* Without storage the flow is simply offered on every load. */
  }
}

/** Steps the person still owes an answer to: pending, or put off with Later. Skipped and declined are choices. */
export function openSteps(state: OnboardingState | null): ResolvedOnboardingStep[] {
  return (
    state?.steps.filter(
      (step) =>
        step.step !== "completion" && (step.status === "pending" || step.status === "deferred"),
    ) ?? []
  );
}

export function markOnboardingOffered(userId: number): void {
  try {
    window.sessionStorage.setItem(`${SESSION_FLAG}${userId}`, "1");
  } catch {
    /* The flow is optional; without storage it is offered again on the next load. */
  }
}

/**
 * The journey as this person can act on it: steps they cannot change are not
 * shown (identity fields once locked, dietary data once answered), and the
 * welcome step only exists when the organizer wrote a message for it.
 */
export function forPerson(
  state: OnboardingState,
  me: Pick<Me, "profileLocked" | "dietaryLocked">,
): OnboardingState {
  const hidden = new Set<OnboardingStep>();
  if (me.profileLocked) hidden.add("profile");
  if (me.dietaryLocked) hidden.add("dietary");
  const welcome = state.welcomeMessage;
  if (!welcome || !Object.values(welcome).some(Boolean)) hidden.add("welcome");
  return { ...state, steps: state.steps.filter((step) => !hidden.has(step.step)) };
}
