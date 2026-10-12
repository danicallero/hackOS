import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { computeMembershipFlags } from "./role.js";

/**
 * Sponsor meal plans (#933). A meal is offered to sponsors when its activity
 * kind has meal semantics and it is linked to a shown schedule entry that has
 * not ended and whose audiences include `sponsor`. An entry with no audience
 * tags is staff-only (see `normalizeVisibilityForAudiences` in the schedule
 * module), so it is never offered. Each meal locks `event_config.meal_plan_cutoff_hours` before it starts.
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

const CUTOFF_HOURS_SQL = `COALESCE((SELECT meal_plan_cutoff_hours FROM event_config WHERE id = 1), 24)`;

const OFFERED_MEALS_FROM_SQL = `
    FROM activities a
    JOIN schedule s ON s.id = a.schedule_id
    LEFT JOIN meal_attendance_plans p ON p.activity_id = a.id AND p.user_id = $1
   WHERE a.category = ANY($2::text[])
     AND s.ends_at > now()
     AND 'sponsor' = ANY(s.audiences)
     AND s.visibility = 'shown'`;

const OFFERED_MEALS_SQL = `
  SELECT a.id AS activity_id, a.name, a.name_i18n, s.starts_at, s.ends_at, s.location,
         p.attending,
         now() >= s.starts_at - make_interval(hours => ${CUTOFF_HOURS_SQL}) AS locked
  ${OFFERED_MEALS_FROM_SQL}
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
    // CUTOFF_HOURS_SQL already falls back to the default.
    cutoffHours: rows[0]!.cutoff_hours,
  };
}

export async function getMealPlan(db: Queryable, userId: number): Promise<MealPlan> {
  await assertSponsor(db, userId);
  const [header, meals] = await Promise.all([planHeader(db, userId), offeredMeals(db, userId)]);
  return { ...header, meals };
}

/** True when a sponsor still has an open (unlocked) offered meal with no answer. */
export async function hasPendingMealPlan(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query<{ pending: boolean }>(
    `SELECT EXISTS (
       SELECT 1 ${OFFERED_MEALS_FROM_SQL}
          AND p.user_id IS NULL
          AND now() < s.starts_at - make_interval(hours => ${CUTOFF_HOURS_SQL})
     ) AS pending`,
    [userId, [...MEAL_ACTIVITY_KINDS]],
  );
  return rows[0]?.pending ?? false;
}

/** Ids among `ids` that are meal-kind activities, offered now or not. */
async function mealActivityIds(db: Queryable, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM activities WHERE id = ANY($1::int[]) AND category = ANY($2::text[])`,
    [ids, [...MEAL_ACTIVITY_KINDS]],
  );
  return new Set(rows.map((row) => row.id));
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
 * Replace semantics: the body must answer every offered, unlocked meal.
 * Locked meals may be echoed back unchanged (clients submit the full list)
 * but never changed; a locked meal the caller never answered is ignored.
 * Meals that ended or stopped being offered since the client loaded the
 * list are ignored too; only ids that are not meal activities are refused. The user row lock serializes concurrent submissions
 * from several tabs/devices so the stored plan is always one whole payload.
 *
 * A staff correction is partial instead: only the meals in the body are
 * written, unanswered meals stay unanswered, and the sponsor's own
 * confirmation (`meal_plan_confirmed_at`) is left untouched.
 */
export async function replaceMealPlan(
  userId: number,
  answers: ReadonlyArray<{ activityId: number; attending: boolean }>,
  correction?: MealPlanCorrection,
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
    const unknown = answers.filter((answer) => !offered.has(answer.activityId));
    const meals = await mealActivityIds(
      client,
      unknown.map((answer) => answer.activityId),
    );
    const notMeal = unknown.find((answer) => !meals.has(answer.activityId));
    if (notMeal) {
      throw new BadRequestError("This meal is not offered to sponsors", {
        code: "meal_not_offered",
        activityId: notMeal.activityId,
      });
    }
    const byActivity = new Map<number, boolean>();
    for (const answer of answers) {
      const meal = offered.get(answer.activityId);
      // Ended or no longer offered since the list was loaded: nothing to store.
      if (!meal) continue;
      if (meal.locked && meal.attending !== null && meal.attending !== answer.attending) {
        throw new ConflictError("Changes to this meal are closed", {
          code: "meal_plan_locked",
          activityId: answer.activityId,
        });
      }
      byActivity.set(answer.activityId, answer.attending);
    }
    const open = [...offered.values()].filter((meal) => !meal.locked);
    const missing = open.filter((meal) => !byActivity.has(meal.activityId));
    if (!correction && missing.length > 0) {
      throw new BadRequestError("Answer every open meal", {
        code: "meal_plan_incomplete",
        activityIds: missing.map((meal) => meal.activityId),
      });
    }

    const openIds = open.map((meal) => meal.activityId).filter((id) => byActivity.has(id));
    let changed: number[] = [];
    if (openIds.length > 0) {
      const { rows } = await client.query<{ activity_id: number }>(
        `INSERT INTO meal_attendance_plans (user_id, activity_id, attending)
         SELECT $1, t.activity_id, t.attending
           FROM unnest($2::int[], $3::boolean[]) AS t(activity_id, attending)
         ON CONFLICT (user_id, activity_id)
           DO UPDATE SET attending = EXCLUDED.attending
           WHERE meal_attendance_plans.attending IS DISTINCT FROM EXCLUDED.attending
         RETURNING activity_id`,
        [userId, openIds, openIds.map((id) => byActivity.get(id))],
      );
      changed = rows.map((row) => row.activity_id);
    }
    // The sponsor's own submission is a benign self-edit and is not audited.
    if (correction && changed.length > 0) {
      const attendingIds = (plan: Map<number, boolean | null>) =>
        [...plan].filter(([, attending]) => attending === true).map(([id]) => id);
      const before = new Map([...offered.values()].map((m) => [m.activityId, m.attending]));
      const after = new Map(before);
      for (const id of openIds) after.set(id, byActivity.get(id) ?? null);
      await audit(client, {
        actorId: correction.actorId,
        entityType: "user",
        entityId: userId,
        action: "meal_plan.updated",
        source: "admin",
        before: { attending: attendingIds(before) },
        after: { attending: attendingIds(after) },
      });
    }
    if (!correction) {
      await client.query(
        `UPDATE users SET meal_plan_confirmed_at = COALESCE(meal_plan_confirmed_at, now())
          WHERE id = $1`,
        [userId],
      );
    }
    return {
      // Sequential: one transaction client cannot run queries concurrently.
      plan: { ...(await planHeader(client, userId)), meals: await offeredMeals(client, userId) },
      written: changed,
    };
  });
  // Ids only, and only those whose answer changed: open logistics panels
  // refetch their aggregate counts.
  if (written.length > 0) {
    await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_MEAL_PLAN_UPDATED, {
      activityIds: written,
    });
  }
  return plan;
}
