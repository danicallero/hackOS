import { pool } from "../../db/pool.js";
import { occupancyEstimate } from "./presence.js";

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

  const meals = await pool.query(
    `SELECT a.id, a.name,
            count(al.id)::int AS served,
            count(DISTINCT al.user_id)::int AS distinct_people
       FROM activities a
       LEFT JOIN activity_logs al ON al.activity_id = a.id
      WHERE a.category = 'meal'
      GROUP BY a.id, a.name
      ORDER BY a.id`,
  );

  const activities = await pool.query(
    `SELECT a.id, a.name, a.category,
            count(al.id)::int AS scans,
            count(DISTINCT al.user_id)::int AS attendees
       FROM activities a
       LEFT JOIN activity_logs al ON al.activity_id = a.id
      WHERE a.requires_scan = true AND a.category <> 'meal'
      GROUP BY a.id, a.name, a.category
      ORDER BY a.id`,
  );

  return {
    accreditedCount: accredited.rows[0].n as number,
    currentlyPresent: occ.presentCount,
    meals: meals.rows.map(
      (r: { id: number; name: string; served: number; distinct_people: number }) => ({
        activityId: r.id,
        name: r.name,
        served: r.served,
        distinctPeople: r.distinct_people,
        repeats: r.served - r.distinct_people,
      }),
    ),
    activities: activities.rows.map(
      (r: { id: number; name: string; category: string; scans: number; attendees: number }) => ({
        activityId: r.id,
        name: r.name,
        category: r.category,
        scans: r.scans,
        attendees: r.attendees,
        repeats: r.scans - r.attendees,
      }),
    ),
  };
}
