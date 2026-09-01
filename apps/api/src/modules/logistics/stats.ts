import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { pool } from "../../db/pool.js";
import { occupancyEstimate } from "./presence.js";
import { isSyntheticOperator } from "./review-fixture-scope.js";

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
  /** Mirrored from the linked schedule item (H50 extension) — resolve on the client with a fallback of English, then this. */
  primaryLanguage: string;
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string | null>;
}

/**
 * Per-activity scan aggregation shared by the H27 stats panel and the
 * scannable-activities list (H25/H26). `where` scopes which activities are
 * counted; the LEFT JOIN keeps activities with zero logs visible. Ordered by
 * the linked schedule's start time (nulls last, for activities with no
 * schedule_id) so operators see activities in chronological order.
 */
async function aggregateActivities(
  where: string,
  params: unknown[] = [],
): Promise<ActivityAggregate[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.category, a.primary_language, a.name_i18n, a.description_i18n,
            count(u.id)::int AS count,
            count(DISTINCT u.id)::int AS distinct_people
       FROM activities a
       LEFT JOIN activity_logs al ON al.activity_id = a.id
       LEFT JOIN users u ON u.id = al.user_id
        AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
       LEFT JOIN schedule s ON s.id = a.schedule_id
      WHERE ${where}
      GROUP BY a.id, a.name, a.category, a.primary_language, a.name_i18n, a.description_i18n, s.starts_at
      ORDER BY s.starts_at ASC NULLS LAST, a.name ASC, a.id ASC`,
    params,
  );
  return rows.map(
    (r: {
      id: number;
      name: string;
      category: string;
      primary_language: string | null;
      name_i18n: Record<string, string> | null;
      description_i18n: Record<string, string | null> | null;
      count: number;
      distinct_people: number;
    }) => ({
      activityId: r.id,
      name: r.name,
      category: r.category,
      count: r.count,
      distinctPeople: r.distinct_people,
      repeats: r.count - r.distinct_people,
      primaryLanguage: r.primary_language ?? "es",
      nameI18n: r.name_i18n ?? {},
      descriptionI18n: r.description_i18n ?? {},
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
  // Which categories count as meals comes from the shared kind registry, so
  // adding a meal-like category needs no SQL change (H25, H26).
  const where =
    category === "meal"
      ? "a.category = ANY($1::text[])"
      : category === "activity"
        ? "a.requires_scan = true AND NOT (a.category = ANY($1::text[]))"
        : "a.category = ANY($1::text[]) OR a.requires_scan = true";
  return aggregateActivities(where, [[...MEAL_ACTIVITY_KINDS]]);
}

/**
 * Accreditation totals by role name (H8 full-replacement: a user's role for
 * this breakdown is simply their highest-visible role name, `Unassigned` for
 * anyone with none — no separate admin/judge/sponsor/staff bucket).
 */
export async function accreditationCountsByRole() {
  const { rows } = await pool.query(
    `SELECT COALESCE(uern.role_name, 'Unassigned') AS role, count(*)::int AS count
       FROM users u
       LEFT JOIN user_effective_role_name uern ON uern.user_id = u.id
      WHERE u.badge_id IS NOT NULL AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = false
      GROUP BY role ORDER BY role`,
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
    `SELECT count(*)::int AS n FROM users
      WHERE badge_id IS NOT NULL AND account_state = 'active' AND anonymized_at IS NULL
        AND is_test_account = false`,
  );
  const occ = await occupancyEstimate(undefined, undefined);
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

/**
 * Per-role scanner stats tile (mobile scanner home screen): eligible
 * (accreditable), accredited, and currently-inside counts, broken down by
 * role name (H8 full-replacement — no separate admin/judge/sponsor/staff
 * bucket; `Unassigned` covers anyone with no visible role), so the client
 * can sum whatever combination of role groups the operator has filtered to.
 * "Eligible" is the same underlying fact `hasEventAccess`/`hasMobileAccess`
 * use: any capability holder, sponsor rep, or enterprise judge is eligible
 * regardless of application status; anyone else (a pure applicant) needs a
 * confirmed spot. Answered as a direct read from Postgres; freshness comes
 * from the existing logistics SSE events rather than a global cache version.
 */
export type ScannerRole = string;

export async function scannerRoleStats(actorId?: number): Promise<
  Array<{
    role: ScannerRole;
    eligible: number;
    accredited: number;
    inside: number;
    /** H8: at least one member of this role bucket is a real capability
     * holder — the mobile scanner's "staff" grouping key, since role names
     * no longer have a fixed admin/staff spelling to match on. */
    hasCapabilities: boolean;
  }>
> {
  const fixtureOnly = actorId != null && (await isSyntheticOperator(pool, actorId));
  const subjectScope = fixtureOnly
    ? `AND u.is_test_account = true
          AND EXISTS (
            SELECT 1 FROM user_effective_role_name uern
             WHERE uern.user_id = u.id AND uern.role_name = 'Participant'
          )`
    : "AND u.is_test_account = false";
  const { rows } = await pool.query<{
    role: ScannerRole;
    eligible: number;
    accredited: number;
    user_ids: number[];
    has_capabilities: boolean;
  }>(
    `WITH classified AS (
       SELECT u.id, u.badge_id,
              COALESCE(uern.role_name, 'Unassigned') AS role,
              EXISTS (SELECT 1 FROM user_effective_capabilities uec WHERE uec.user_id = u.id) AS has_capabilities,
              (EXISTS (SELECT 1 FROM user_effective_capabilities uec WHERE uec.user_id = u.id)
                OR EXISTS (SELECT 1 FROM enterprise_judges ej WHERE ej.user_id = u.id)
                OR EXISTS (SELECT 1 FROM sponsors s WHERE s.user_id = u.id)) AS is_operational,
              EXISTS (
                SELECT 1 FROM application_responses ar
                 WHERE ar.user_id = u.id AND ar.status = 'confirmed'
              ) AS confirmed
         FROM users u
         LEFT JOIN user_effective_role_name uern ON uern.user_id = u.id
        WHERE u.account_state = 'active' AND u.anonymized_at IS NULL ${subjectScope}
     )
     SELECT role,
            count(*) FILTER (WHERE is_operational OR confirmed)::int AS eligible,
            count(*) FILTER (WHERE badge_id IS NOT NULL)::int AS accredited,
            array_agg(id) AS user_ids,
            bool_or(has_capabilities) AS has_capabilities
       FROM classified
      GROUP BY role
      ORDER BY role`,
  );

  const occ = await occupancyEstimate(undefined, actorId);
  const present = new Set(occ.present);

  return rows.map((row) => ({
    role: row.role,
    eligible: row.eligible,
    accredited: row.accredited,
    inside: row.user_ids.filter((id) => present.has(id)).length,
    hasCapabilities: Boolean(row.has_capabilities),
  }));
}
