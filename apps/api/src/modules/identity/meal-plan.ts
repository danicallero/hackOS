import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { type Queryable, withTransaction } from "../../db/pool.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { computeMembershipFlags } from "./role.js";

/**
 * Sponsor meal plans (#933). A meal is offered to sponsors when its activity
 * kind has meal semantics, it is linked to a schedule entry that has not
 * ended, and that entry is either tagged for sponsors and shown, or carries
 * no audience tags at all (an event-wide meal, which the schedule keeps
 * hidden from public listings by `schedule_visibility_requires_audience`).
 * Each meal locks `event_config.meal_plan_cutoff_hours` before it starts.
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
  meals: MealPlanEntry[];
}

const OFFERED_MEALS_SQL = `
  SELECT a.id AS activity_id, a.name, a.name_i18n, s.starts_at, s.ends_at, s.location,
         p.attending,
         now() >= s.starts_at - make_interval(hours => COALESCE(
           (SELECT meal_plan_cutoff_hours FROM event_config WHERE id = 1), 24
         )) AS locked
    FROM activities a
    JOIN schedule s ON s.id = a.schedule_id
    LEFT JOIN meal_attendance_plans p ON p.activity_id = a.id AND p.user_id = $1
   WHERE a.category = ANY($2::text[])
     AND s.ends_at > now()
     AND (cardinality(s.audiences) = 0
          OR ('sponsor' = ANY(s.audiences) AND s.visibility = 'shown'))
   ORDER BY s.starts_at, a.id`;

interface OfferedMealRow {
  activity_id: number;
  name: string;
  name_i18n: Record<string, string> | null;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  attending: boolean | null;
  locked: boolean;
}

async function offeredMeals(db: Queryable, userId: number): Promise<MealPlanEntry[]> {
  const { rows } = await db.query<OfferedMealRow>(OFFERED_MEALS_SQL, [
    userId,
    [...MEAL_ACTIVITY_KINDS],
  ]);
  return rows.map((row) => ({
    activityId: row.activity_id,
    name: row.name,
    nameI18n: row.name_i18n,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    location: row.location,
    attending: row.attending,
    locked: row.locked,
  }));
}

async function assertSponsor(db: Queryable, userId: number): Promise<void> {
  const { isSponsorRep } = await computeMembershipFlags(db, userId);
  if (!isSponsorRep) {
    throw new ForbiddenError("Only sponsor representatives have a meal plan", {
      code: "not_sponsor",
    });
  }
}

async function confirmedAt(db: Queryable, userId: number): Promise<string | null> {
  const { rows } = await db.query<{ meal_plan_confirmed_at: Date | null }>(
    `SELECT meal_plan_confirmed_at FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.meal_plan_confirmed_at?.toISOString() ?? null;
}

export async function getMealPlan(db: Queryable, userId: number): Promise<MealPlan> {
  await assertSponsor(db, userId);
  return { confirmedAt: await confirmedAt(db, userId), meals: await offeredMeals(db, userId) };
}

/** True when a sponsor still has an open (unlocked) offered meal with no answer. */
export async function hasPendingMealPlan(db: Queryable, userId: number): Promise<boolean> {
  const meals = await offeredMeals(db, userId);
  return meals.some((meal) => !meal.locked && meal.attending === null);
}

/**
 * Replace semantics: the body must answer every offered, unlocked meal.
 * Locked meals may be echoed back unchanged (clients submit the full list)
 * but never changed. The user row lock serializes concurrent submissions
 * from several tabs/devices so the stored plan is always one whole payload.
 */
export async function replaceMealPlan(
  userId: number,
  answers: ReadonlyArray<{ activityId: number; attending: boolean }>,
): Promise<MealPlan> {
  const { plan, written } = await withTransaction(async (client) => {
    const { rows: userRows } = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found", { userId });
    await assertSponsor(client, userId);

    const offered = new Map((await offeredMeals(client, userId)).map((m) => [m.activityId, m]));
    const byActivity = new Map<number, boolean>();
    for (const answer of answers) {
      const meal = offered.get(answer.activityId);
      if (!meal) {
        throw new BadRequestError("This meal is not offered to sponsors", {
          code: "meal_not_offered",
          activityId: answer.activityId,
        });
      }
      if (meal.locked && meal.attending !== answer.attending) {
        throw new ConflictError("Changes to this meal are closed", {
          code: "meal_plan_locked",
          activityId: answer.activityId,
        });
      }
      byActivity.set(answer.activityId, answer.attending);
    }
    const open = [...offered.values()].filter((meal) => !meal.locked);
    const missing = open.filter((meal) => !byActivity.has(meal.activityId));
    if (missing.length > 0) {
      throw new BadRequestError("Answer every open meal", {
        code: "meal_plan_incomplete",
        activityIds: missing.map((meal) => meal.activityId),
      });
    }

    const openIds = open.map((meal) => meal.activityId);
    if (openIds.length > 0) {
      await client.query(
        `INSERT INTO meal_attendance_plans (user_id, activity_id, attending)
         SELECT $1, t.activity_id, t.attending
           FROM unnest($2::int[], $3::boolean[]) AS t(activity_id, attending)
         ON CONFLICT (user_id, activity_id)
           DO UPDATE SET attending = EXCLUDED.attending
           WHERE meal_attendance_plans.attending IS DISTINCT FROM EXCLUDED.attending`,
        [userId, openIds, openIds.map((id) => byActivity.get(id))],
      );
    }
    await client.query(
      `UPDATE users SET meal_plan_confirmed_at = COALESCE(meal_plan_confirmed_at, now())
        WHERE id = $1`,
      [userId],
    );
    return {
      plan: {
        confirmedAt: await confirmedAt(client, userId),
        meals: await offeredMeals(client, userId),
      },
      written: openIds,
    };
  });
  // Ids only: open logistics panels refetch their aggregate counts.
  if (written.length > 0) {
    await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_MEAL_PLAN_UPDATED, {
      activityIds: written,
    });
  }
  return plan;
}
