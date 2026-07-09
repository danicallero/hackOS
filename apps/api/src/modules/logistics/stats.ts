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
 * counted; the LEFT JOIN keeps activities with zero logs visible.
 */
async function aggregateActivities(where: string): Promise<ActivityAggregate[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.category,
            count(al.id)::int AS count,
            count(DISTINCT al.user_id)::int AS distinct_people
       FROM activities a
       LEFT JOIN activity_logs al ON al.activity_id = a.id
      WHERE ${where}
      GROUP BY a.id, a.name, a.category
      ORDER BY a.name ASC, a.id ASC`,
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

/**
 * H27 operational logistics panel (LOGISTICS_STATS): accredited count,
 * currently-present estimate, per-meal served/repeats, per-activity
 * attendance. The pre-event applications funnel belongs to the applications
 * workstream and is intentionally not here.
 */
export async function logisticsStats() {
  const accredited = await pool.query(
    `SELECT count(*)::int AS n FROM users WHERE badge_id IS NOT NULL`,
  );
  const occ = await occupancyEstimate();
  const meals = await scannableActivities("meal");
  const activities = await scannableActivities("activity");

  return {
    accreditedCount: accredited.rows[0].n as number,
    currentlyPresent: occ.presentCount,
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
