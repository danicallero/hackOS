import { apiFetch } from "./api";
import { registerSignOutListener } from "./sign-out-events";
import type { Me, ProfileTask } from "./types";

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

/** H7: locked dietary data is only changed by staff, so it is never asked for. */
export function promptableProfileTasks(me: Me): ProfileTask[] {
  const tasks = (me.pendingProfileTasks ?? []).filter(
    (task) => task !== "dietary" || !me.dietaryLocked,
  );
  if (me.pendingRsvps && !tasks.includes("meal_plan") && !tasks.includes("rsvp"))
    tasks.push("rsvp");
  return tasks;
}

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
  if (promptableProfileTasks(me).length === 0) return false;
  if (handledUserIds.has(me.id)) return false;
  // "/" only redirects into the tabs; pushing over it would race that redirect.
  if (pathname === "/" || pathname === PROFILE_TASKS_PATH) return false;
  return !isScannerPath(pathname);
}

export function parseProfileTasks(value: string | string[] | undefined): ProfileTask[] {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return (["dietary", "meal_plan", "rsvp"] as const).filter((task) =>
    raw.split(",").includes(task),
  );
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
