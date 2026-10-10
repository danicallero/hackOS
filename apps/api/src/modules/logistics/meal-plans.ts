import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { pool } from "../../db/pool.js";
import { toCsv } from "../../lib/csv.js";
import { NotFoundError } from "../../lib/errors.js";

/**
 * Logistics read side of sponsor meal plans (#933). Aggregates stay under
 * `logistics:stats`; the per-person CSV carries dietary data and needs
 * `meal-plans:export`. A meal counts here when its activity has meal semantics
 * and its schedule entry includes the `sponsor` audience, ended or not, so
 * planned vs served stays visible after the meal. Counted people are active,
 * non-anonymized, non-test sponsor representatives.
 */

const PLANNED_MEALS_SQL = `
  SELECT a.id, a.name, a.name_i18n, s.starts_at
    FROM activities a
    JOIN schedule s ON s.id = a.schedule_id
   WHERE a.category = ANY($1::text[])
     AND 'sponsor' = ANY(s.audiences)
     AND ($2::int IS NULL OR a.id = $2)
   ORDER BY s.starts_at, a.id`;

const SPONSOR_REPS_SQL = `
  SELECT u.id, u.name, u.surname, u.food_intolerances, u.food_intolerance_notes
    FROM users u
   WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
     AND u.is_test_account = false
     AND EXISTS (SELECT 1 FROM sponsors sp WHERE sp.user_id = u.id)`;

export interface MealPlanSummary {
  activityId: number;
  name: string;
  nameI18n: Record<string, string>;
  startsAt: string;
  attending: number;
  notAttending: number;
  unanswered: number;
  /** Among people attending, one entry per declared intolerance. */
  intolerances: Array<{ id: number; label: Record<string, string>; n: number }>;
  /** People attending with free-text dietary notes. */
  withNotes: number;
}

export async function mealPlanSummaries(activityId?: number): Promise<MealPlanSummary[]> {
  const { rows: meals } = await pool.query<{
    id: number;
    name: string;
    name_i18n: Record<string, string> | null;
    starts_at: Date;
  }>(PLANNED_MEALS_SQL, [[...MEAL_ACTIVITY_KINDS], activityId ?? null]);
  if (meals.length === 0) return [];
  const ids = meals.map((m) => m.id);

  const { rows: counts } = await pool.query<{
    activity_id: number;
    attending: number;
    not_attending: number;
    with_notes: number;
    reps: number;
  }>(
    `WITH reps AS (${SPONSOR_REPS_SQL})
     SELECT m.activity_id,
            count(*) FILTER (WHERE p.attending)::int AS attending,
            count(*) FILTER (WHERE p.attending = false)::int AS not_attending,
            count(*) FILTER (WHERE p.attending AND btrim(coalesce(r.food_intolerance_notes, '')) <> '')::int AS with_notes,
            count(r.id)::int AS reps
       FROM unnest($1::int[]) AS m(activity_id)
       CROSS JOIN reps r
       LEFT JOIN meal_attendance_plans p ON p.activity_id = m.activity_id AND p.user_id = r.id
      GROUP BY m.activity_id`,
    [ids],
  );
  const { rows: intolerances } = await pool.query<{
    activity_id: number;
    id: number;
    label: Record<string, string>;
    n: number;
  }>(
    `WITH reps AS (${SPONSOR_REPS_SQL})
     SELECT p.activity_id, fi.id, fi.label, count(*)::int AS n
       FROM meal_attendance_plans p
       JOIN reps r ON r.id = p.user_id
       JOIN LATERAL unnest(r.food_intolerances) AS ui(id) ON true
       JOIN food_intolerances fi ON fi.id = ui.id
      WHERE p.attending AND p.activity_id = ANY($1::int[])
      GROUP BY p.activity_id, fi.id, fi.label
      ORDER BY n DESC, fi.id`,
    [ids],
  );

  const countsBy = new Map(counts.map((c) => [c.activity_id, c]));
  return meals.map((m) => {
    const c = countsBy.get(m.id);
    const attending = c?.attending ?? 0;
    const notAttending = c?.not_attending ?? 0;
    return {
      activityId: m.id,
      name: m.name,
      nameI18n: m.name_i18n ?? {},
      startsAt: m.starts_at.toISOString(),
      attending,
      notAttending,
      unanswered: (c?.reps ?? 0) - attending - notAttending,
      intolerances: intolerances
        .filter((i) => i.activity_id === m.id)
        .map((i) => ({ id: i.id, label: i.label, n: i.n })),
      withNotes: c?.with_notes ?? 0,
    };
  });
}

function intoleranceLabel(label: Record<string, string>, language: string): string {
  return label[language] ?? label.en ?? label.es ?? Object.values(label)[0] ?? "";
}

/**
 * Catering CSV for one meal: one row per sponsor representative attending,
 * with their enterprise(s), intolerance labels (in `language`) and notes.
 */
export async function exportMealPlanCsv(activityId: number, language: string): Promise<string> {
  const [meal] = await mealPlanSummaries(activityId);
  if (!meal) throw new NotFoundError("Meal not found", { activityId });
  const { rows } = await pool.query<{
    name: string | null;
    surname: string | null;
    enterprises: string | null;
    labels: Record<string, string>[] | null;
    notes: string | null;
  }>(
    `WITH reps AS (${SPONSOR_REPS_SQL})
     SELECT r.name, r.surname,
            (SELECT string_agg(DISTINCT e.name, '; ')
               FROM sponsors sp JOIN enterprises e ON e.id = sp.enterprise_id
              WHERE sp.user_id = r.id) AS enterprises,
            (SELECT array_agg(fi.label ORDER BY fi.id)
               FROM food_intolerances fi
              WHERE fi.id = ANY(r.food_intolerances)) AS labels,
            nullif(btrim(r.food_intolerance_notes), '') AS notes
       FROM meal_attendance_plans p
       JOIN reps r ON r.id = p.user_id
      WHERE p.activity_id = $1 AND p.attending
      ORDER BY r.surname NULLS LAST, r.name NULLS LAST, r.id`,
    [activityId],
  );
  return toCsv(
    ["name", "surname", "enterprise", "intolerances", "notes"],
    rows.map((r) => [
      r.name,
      r.surname,
      r.enterprises,
      (r.labels ?? []).map((l) => intoleranceLabel(l, language)).join("; "),
      r.notes,
    ]),
  );
}
