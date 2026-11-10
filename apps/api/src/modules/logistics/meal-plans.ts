import { exportRsvpCsv, rsvpSummaries } from "../rsvps/summary.js";

/**
 * Logistics read side of meal plans (#933), now a view over per-activity RSVPs
 * restricted to meal activities. Aggregates stay under `logistics:stats`; the
 * per-person CSV carries dietary data and needs `meal-plans:export`. The
 * counted people follow the RSVP eligibility rule (derived attendance kind in
 * the asked kinds, never participants), active, non-anonymized, on the
 * reader's side of the review fixture boundary.
 */

export interface MealPlanSummary {
  activityId: number;
  name: string;
  nameI18n: Record<string, string>;
  startsAt: string;
  attending: number;
  notAttending: number;
  /** Stored "unsure" answers; they are neither attending nor unanswered. */
  unsure: number;
  unanswered: number;
  /** Among people attending, one entry per declared intolerance. */
  intolerances: Array<{ id: number; label: Record<string, string>; n: number }>;
  /** People attending with free-text dietary notes. */
  withNotes: number;
}

export async function mealPlanSummaries(
  actorId: number,
  activityId?: number,
): Promise<MealPlanSummary[]> {
  const summaries = await rsvpSummaries(actorId, { activityId, mealsOnly: true });
  return summaries.map((s) => ({
    activityId: s.activityId,
    name: s.name,
    nameI18n: s.nameI18n,
    startsAt: s.startsAt,
    attending: s.attending,
    notAttending: s.notAttending,
    unsure: s.unsure,
    unanswered: s.unanswered,
    intolerances: s.intolerances,
    withNotes: s.withNotes,
  }));
}

/** Catering CSV for one meal: one row per eligible person attending. */
export function exportMealPlanCsv(
  actorId: number,
  activityId: number,
  language: string,
): Promise<string> {
  return exportRsvpCsv(actorId, activityId, language, { mealsOnly: true });
}
