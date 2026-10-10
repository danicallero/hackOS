import { apiFetch } from "./api";
import type { Lang } from "./i18n";
import { registerSignOutListener } from "./sign-out-events";
import type { Me, MealPlan, ProfileTask } from "./types";

/**
 * #933: the next-entry prompt is shown at most once per signed-in account
 * while the app process lives. "Later" (or swiping the sheet away) is an
 * in-memory deferral, so the prompt returns after a restart or a new sign-in.
 */
const handledUserIds = new Set<number>();

registerSignOutListener(() => handledUserIds.clear());

export function markProfileTasksHandled(userId: number): void {
  handledUserIds.add(userId);
}

/** Test seam: forget deferrals as a process restart would. */
export function resetProfileTasksHandled(): void {
  handledUserIds.clear();
}

/**
 * Surfaces that mount QrCamera/NfcReader (general scanner, activity scanner,
 * person operations under every tab): the prompt waits until the operator
 * leaves them.
 */
export function isScannerPath(pathname: string): boolean {
  return (
    /^\/scan(\/|$)/.test(pathname) ||
    /^\/activities\/\d+(\/|$)/.test(pathname) ||
    /^\/(activities|others)\/person(\/|$)/.test(pathname)
  );
}

export const PROFILE_TASKS_PATH = "/profile-tasks";

export function shouldPresentProfileTasks({
  me,
  offline,
  navigationReady,
  sessionPending,
  pathname,
}: {
  me: Me | null;
  offline: boolean;
  navigationReady: boolean;
  /** The root layout is still resolving the initial session. */
  sessionPending: boolean;
  pathname: string;
}): boolean {
  if (!me || offline || !navigationReady || sessionPending) return false;
  if (!me.hasEventAccess || me.accountState !== "active") return false;
  if (!me.pendingProfileTasks?.length) return false;
  if (handledUserIds.has(me.id)) return false;
  // "/" only redirects into the tabs; pushing over it would race that redirect.
  if (pathname === "/" || pathname === PROFILE_TASKS_PATH) return false;
  return !isScannerPath(pathname);
}

export function parseProfileTasks(value: string | string[] | undefined): ProfileTask[] {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return (["dietary", "meal_plan"] as const).filter((task) => raw.split(",").includes(task));
}

export interface DietaryDraft {
  noRestrictions: boolean;
  intolerances: number[];
  notes: string;
}

export function dietaryDraftFromMe(me: Me): DietaryDraft {
  const notes = me.foodIntoleranceNotes ?? "";
  return {
    noRestrictions:
      Boolean(me.dietaryConfirmedAt) && me.foodIntolerances.length === 0 && notes.trim() === "",
    intolerances: me.foodIntolerances,
    notes,
  };
}

/** An explicit answer: "No restrictions", or at least one restriction or note. */
export function isDietaryAnswered(draft: DietaryDraft): boolean {
  return draft.noRestrictions || draft.intolerances.length > 0 || draft.notes.trim() !== "";
}

export function toggleIntolerance(draft: DietaryDraft, id: number, on: boolean): DietaryDraft {
  const intolerances = on
    ? [...new Set([...draft.intolerances, id])]
    : draft.intolerances.filter((item) => item !== id);
  return { ...draft, noRestrictions: on ? false : draft.noRestrictions, intolerances };
}

/** "No restrictions" is exclusive: it clears every restriction and note. */
export function setNoRestrictions(draft: DietaryDraft, on: boolean): DietaryDraft {
  return on
    ? { noRestrictions: true, intolerances: [], notes: "" }
    : { ...draft, noRestrictions: false };
}

/** PATCH /api/me records an explicit dietary answer, even an empty one (#933). */
export async function saveDietary(draft: DietaryDraft): Promise<void> {
  const notes = draft.notes.trim();
  await apiFetch("/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      foodIntolerances: draft.noRestrictions ? [] : draft.intolerances,
      foodIntoleranceNotes: draft.noRestrictions || notes === "" ? null : notes,
    }),
  });
}

/**
 * H7: a locked profile can only confirm what staff already recorded. The
 * stored values are resubmitted verbatim so the API sees no change.
 */
export async function confirmLockedDietary(me: Me): Promise<void> {
  await apiFetch("/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      foodIntolerances: me.foodIntolerances,
      foodIntoleranceNotes: me.foodIntoleranceNotes,
    }),
  });
}

export function mealPlanCacheKey(userId: number): string {
  // `user:<id>:` prefix: sign-out and 401 invalidation clear it with the profile.
  return `user:${userId}:meal-plan`;
}

export function fetchMealPlan(signal?: AbortSignal): Promise<MealPlan> {
  return apiFetch<MealPlan>("/api/me/meal-plan", { signal });
}

/**
 * PUT replaces the whole plan and must answer every unlocked meal. It is only
 * sent from an explicit Save, so an unticked meal is a "not attending" answer
 * (same model as the web checklist).
 */
export function mealPlanAnswers(
  plan: MealPlan,
  overrides: Record<number, boolean> = {},
): { activityId: number; attending: boolean }[] {
  return plan.meals
    .filter((meal) => !meal.locked)
    .map((meal) => ({
      activityId: meal.activityId,
      attending: overrides[meal.activityId] ?? meal.attending ?? false,
    }));
}

export function saveMealPlan(
  plan: MealPlan,
  overrides: Record<number, boolean>,
): Promise<MealPlan> {
  return apiFetch<MealPlan>("/api/me/meal-plan", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ meals: mealPlanAnswers(plan, overrides) }),
  });
}

/** "Sat 13:30 · Lunch" in the user's language. */
export function mealLabel(meal: MealPlan["meals"][number], language: Lang): string {
  const startsAt = new Date(meal.startsAt);
  const when = Number.isNaN(startsAt.getTime())
    ? meal.startsAt
    : `${startsAt.toLocaleDateString(language, { weekday: "short" })} ${startsAt.toLocaleTimeString(
        language,
        { hour: "2-digit", minute: "2-digit" },
      )}`;
  return `${when} · ${meal.nameI18n?.[language] || meal.name}`;
}
