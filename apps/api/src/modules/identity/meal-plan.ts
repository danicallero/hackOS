import type { Queryable } from "../../db/pool.js";
import { ForbiddenError } from "../../lib/errors.js";
import { currentEventKey } from "../event/context.js";
import { CUTOFF_HOURS_SQL, offeredRsvps, submitRsvps } from "../rsvps/service.js";
import { attendanceKind } from "./attendance.js";

/**
 * Meal plans (#933) are now a facade over per-activity RSVPs (`rsvps` module):
 * the meal entries of the caller's offered RSVPs. A meal is offered when its
 * RSVP settings are enabled for the current event key and ask the caller's
 * attendance kind; registered participants and unclassified accounts are
 * never eligible (403 `meal_plan_not_eligible`). `unsure` reads as unanswered
 * here: the facade keeps its original yes/no shape.
 */

export interface MealPlanEntry {
  activityId: number;
  name: string;
  nameI18n: Record<string, string> | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  attending: boolean | null;
  locked: boolean;
}

export interface MealPlan {
  confirmedAt: string | null;
  /** Hours before each meal starts when its answer locks; clients show it as the lock consequence. */
  cutoffHours: number;
  meals: MealPlanEntry[];
}

async function assertEligible(db: Queryable, userId: number): Promise<string> {
  const kind = await attendanceKind(db, userId);
  if (!kind || kind === "participant") {
    throw new ForbiddenError("Meal plans are not offered to this person", {
      code: "meal_plan_not_eligible",
    });
  }
  return kind;
}

async function planHeader(
  db: Queryable,
  userId: number,
): Promise<Pick<MealPlan, "confirmedAt" | "cutoffHours">> {
  const { rows } = await db.query<{ meal_plan_confirmed_at: Date | null; cutoff_hours: number }>(
    `SELECT meal_plan_confirmed_at, ${CUTOFF_HOURS_SQL} AS cutoff_hours FROM users WHERE id = $1`,
    [userId],
  );
  return {
    confirmedAt: rows[0]?.meal_plan_confirmed_at?.toISOString() ?? null,
    cutoffHours: rows[0]?.cutoff_hours ?? 24,
  };
}

async function mealEntries(db: Queryable, userId: number, kind: string): Promise<MealPlanEntry[]> {
  const { rows } = await db.query<{ language: "es" | "gl" | "en" }>(
    `SELECT language FROM users WHERE id = $1`,
    [userId],
  );
  const items = await offeredRsvps(
    db,
    userId,
    kind,
    await currentEventKey(db),
    rows[0]?.language ?? "en",
    { mealsOnly: true },
  );
  return items.map((item) => ({
    activityId: item.activityId,
    name: item.name,
    nameI18n: item.nameI18n,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    location: item.location,
    attending: item.answer === "yes" ? true : item.answer === "no" ? false : null,
    locked: item.locked,
  }));
}

export async function getMealPlan(db: Queryable, userId: number): Promise<MealPlan> {
  const kind = await assertEligible(db, userId);
  const [header, meals] = await Promise.all([
    planHeader(db, userId),
    mealEntries(db, userId, kind),
  ]);
  return { ...header, meals };
}

/**
 * A staff correction (PUT /api/users/:id/meal-plan): the route decides it, not
 * a comparison of actor and subject, so staff editing their own plan through
 * that route is still audited (H53).
 */
export interface MealPlanCorrection {
  actorId: number;
}

/**
 * Replace semantics over the meals (see `submitRsvps`): the body must answer
 * every open meal, locked ones may be echoed unchanged but never changed, and
 * a staff correction is partial and audited. Kept for the original yes/no API.
 */
export async function replaceMealPlan(
  userId: number,
  answers: ReadonlyArray<{ activityId: number; attending: boolean }>,
  correction?: MealPlanCorrection,
): Promise<MealPlan> {
  const { pool } = await import("../../db/pool.js");
  const kind = await assertEligible(pool, userId);
  await submitRsvps(
    userId,
    answers.map((a) => ({
      activityId: a.activityId,
      answer: a.attending ? ("yes" as const) : ("no" as const),
    })),
    { actorId: correction?.actorId, mealFacade: true },
  );
  return {
    ...(await planHeader(pool, userId)),
    meals: await mealEntries(pool, userId, kind),
  };
}
