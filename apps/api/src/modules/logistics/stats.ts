import { pool } from "../../db/pool.js";
import { occupancyEstimate } from "./presence.js";

export interface ActivityAggregate {
  activityId: number;
  name: string;
  category: string;
  /** Total scans / servings logged. */
  count: number;
  /** Distinct people who passed through. */
  distinctPeople: number;
  /** count - distinctPeople (repeat servings / re-scans). */
  repeats: number;
}

/**
 * Per-activity scan aggregation shared by the H27 stats panel and the
 * scannable-activities list (H25/H26). `where` scopes which activities are
 * counted; the LEFT JOIN keeps activities with zero logs visible. Ordered by
 * the linked schedule's start time (nulls last, for activities with no
 * schedule_id) so operators see activities in chronological order.
 */
async function aggregateActivities(where: string): Promise<ActivityAggregate[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.category,
            count(al.id)::int AS count,
            count(DISTINCT al.user_id)::int AS distinct_people
       FROM activities a
       LEFT JOIN activity_logs al ON al.activity_id = a.id
       LEFT JOIN schedule s ON s.id = a.schedule_id
      WHERE ${where}
      GROUP BY a.id, a.name, a.category, s.starts_at
      ORDER BY s.starts_at ASC NULLS LAST, a.name ASC, a.id ASC`,
  );
  return rows.map(
    (r: {
      id: number;
      name: string;
      category: string;
      count: number;
      distinct_people: number;
    }) => ({
      activityId: r.id,
      name: r.name,
      category: r.category,
      count: r.count,
      distinctPeople: r.distinct_people,
      repeats: r.count - r.distinct_people,
    }),
  );
}

/**
 * Activities a scan operator can register against (H25 meals + H26
 * requires_scan activities), with live counts so each station can show its own
 * numbers without the LOGISTICS_STATS capability. `category` narrows the list.
 */
export async function scannableActivities(
  category?: "meal" | "activity",
): Promise<ActivityAggregate[]> {
  const where =
    category === "meal"
      ? "a.category = 'meal'"
      : category === "activity"
        ? "a.requires_scan = true AND a.category <> 'meal'"
        : "a.category = 'meal' OR a.requires_scan = true";
  return aggregateActivities(where);
}

/** Accreditation totals by operational role; admins are included in staff. */
export async function accreditationCountsByRole() {
  const { rows } = await pool.query(
    `WITH RECURSIVE effective_groups(user_id, group_id) AS (
       SELECT user_id, group_id FROM permission_group_members
       UNION
       SELECT eg.user_id, pgi.child_group_id
         FROM effective_groups eg
         JOIN permission_group_includes pgi ON pgi.parent_group_id = eg.group_id
     ), classified AS (
       SELECT u.id,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM effective_groups eg
                  JOIN group_capabilities gc ON gc.group_id = eg.group_id
                  WHERE eg.user_id = u.id AND gc.capability = '*'
                ) THEN 'staff'
                WHEN EXISTS (SELECT 1 FROM room_judges rj WHERE rj.user_id = u.id) THEN 'judge'
                WHEN EXISTS (SELECT 1 FROM sponsors s WHERE s.user_id = u.id) THEN 'sponsor'
                WHEN EXISTS (SELECT 1 FROM effective_groups eg WHERE eg.user_id = u.id) THEN 'staff'
                ELSE 'participant'
              END AS role
         FROM users u
        WHERE u.badge_id IS NOT NULL AND u.anonymized_at IS NULL
     )
     SELECT role, count(*)::int AS count
       FROM classified GROUP BY role ORDER BY role`,
  );
  return rows.map((row) => ({ role: String(row.role), count: Number(row.count) }));
}

/**
 * H27 operational logistics panel (LOGISTICS_STATS): accredited count,
 * currently-present estimate, per-meal served/repeats, per-activity
 * attendance. The pre-event applications funnel belongs to the applications
 * workstream and is intentionally not here.
 */
export async function logisticsStats() {
  const accredited = await pool.query(
    `SELECT count(*)::int AS n FROM users WHERE badge_id IS NOT NULL AND anonymized_at IS NULL`,
  );
  const occ = await occupancyEstimate();
  const meals = await scannableActivities("meal");
  const activities = await scannableActivities("activity");
  const accreditedByRole = await accreditationCountsByRole();

  return {
    accreditedCount: accredited.rows[0].n as number,
    currentlyPresent: occ.presentCount,
    accreditedByRole,
    meals: meals.map((m) => ({
      activityId: m.activityId,
      name: m.name,
      served: m.count,
      distinctPeople: m.distinctPeople,
      repeats: m.repeats,
    })),
    activities: activities.map((a) => ({
      activityId: a.activityId,
      name: a.name,
      category: a.category,
      scans: a.count,
      attendees: a.distinctPeople,
      repeats: a.repeats,
    })),
  };
}
