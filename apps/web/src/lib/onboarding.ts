import type {
  OnboardingAction,
  OnboardingStep,
  ResolvedOnboardingStep,
} from "@hackos/shared/onboarding";
import { api } from "./api";

/** GET /api/me/onboarding. The server resolves every step; the client never re-derives status. */
export interface OnboardingState {
  eventKey: string;
  revision: number;
  steps: ResolvedOnboardingStep[];
  /** The organizer's localized welcome text, when the API serves it to attendees. */
  welcomeMessage?: Partial<Record<"es" | "gl" | "en", string>> | null;
}

export const ONBOARDING_PATH = "/onboarding";

export const readOnboarding = (signal?: AbortSignal) =>
  api.get<OnboardingState>("/api/me/onboarding", { signal });

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

/** The app offers the flow once per browser session, never as a gate. */
export function wasOnboardingOffered(userId: number): boolean {
  try {
    return window.sessionStorage.getItem(`${SESSION_FLAG}${userId}`) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingOffered(userId: number): void {
  try {
    window.sessionStorage.setItem(`${SESSION_FLAG}${userId}`, "1");
  } catch {
    /* The flow is optional; without storage it is offered again on the next load. */
  }
}
