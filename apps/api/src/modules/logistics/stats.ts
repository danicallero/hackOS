import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
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
            count(al.id)::int AS count,
            count(DISTINCT al.user_id)::int AS distinct_people
       FROM activities a
       LEFT JOIN activity_logs al ON al.activity_id = a.id
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
                WHEN EXISTS (
                  SELECT 1 FROM effective_groups eg
                  JOIN group_capabilities gc ON gc.group_id = eg.group_id
                 WHERE eg.user_id = u.id
                ) THEN 'staff'
                WHEN EXISTS (SELECT 1 FROM manual_attendee_roles mar WHERE mar.user_id = u.id AND mar.role = 'mentor') THEN 'mentor'
                WHEN EXISTS (SELECT 1 FROM manual_attendee_roles mar WHERE mar.user_id = u.id AND mar.role = 'participant') THEN 'participant'
                WHEN EXISTS (
                  SELECT 1 FROM application_responses ar JOIN applications a ON a.id = ar.application_id
                 WHERE ar.user_id = u.id AND ar.status <> 'draft' AND a.type = 'mentor'
                ) THEN 'mentor'
                WHEN EXISTS (
                  SELECT 1 FROM application_responses ar JOIN applications a ON a.id = ar.application_id
                 WHERE ar.user_id = u.id AND ar.status <> 'draft' AND a.type = 'participant'
                ) THEN 'participant'
                ELSE 'unassigned'
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

/**
 * Per-role scanner stats tile (mobile scanner home screen): eligible
 * (accreditable), accredited, and currently-inside counts, broken down by
 * the same role classification the scanner roster snapshot uses (H22-H26 —
 * see `scannerSnapshot` in scanner-sync.ts), so the client can sum whatever
 * combination of role groups the operator has filtered to. Answered as a
 * plain GET, so it rides the app-wide read cache (30s TTL, invalidated on
 * any write — app.ts) instead of needing bespoke caching here.
 */
export type ScannerRole =
  | "admin"
  | "judge"
  | "sponsor"
  | "staff"
  | "mentor"
  | "participant"
  | "unassigned";

export async function scannerRoleStats(): Promise<
  Array<{ role: ScannerRole; eligible: number; accredited: number; inside: number }>
> {
  const { rows } = await pool.query<{
    role: ScannerRole;
    eligible: number;
    accredited: number;
    user_ids: number[];
  }>(
    `WITH RECURSIVE effective_groups (user_id, group_id) AS (
       SELECT user_id, group_id FROM permission_group_members
       UNION
       SELECT eg.user_id, gi.child_group_id
         FROM effective_groups eg
         JOIN permission_group_includes gi ON gi.parent_group_id = eg.group_id
     ), user_caps AS (
       SELECT eg.user_id,
              bool_or(gc.capability = '*') AS is_admin,
              count(gc.capability) > 0 AS has_capability
         FROM effective_groups eg
         JOIN group_capabilities gc ON gc.group_id = eg.group_id
        GROUP BY eg.user_id
     ), classified AS (
       SELECT u.id, u.badge_id,
              CASE
                WHEN COALESCE(uc.is_admin, false) THEN 'admin'
                WHEN EXISTS (SELECT 1 FROM room_judges rj WHERE rj.user_id = u.id) THEN 'judge'
                WHEN EXISTS (SELECT 1 FROM sponsors s WHERE s.user_id = u.id) THEN 'sponsor'
                WHEN COALESCE(uc.has_capability, false) THEN 'staff'
                WHEN EXISTS (SELECT 1 FROM manual_attendee_roles mar WHERE mar.user_id = u.id AND mar.role = 'mentor') THEN 'mentor'
                WHEN EXISTS (SELECT 1 FROM manual_attendee_roles mar WHERE mar.user_id = u.id AND mar.role = 'participant') THEN 'participant'
                WHEN EXISTS (
                  SELECT 1 FROM application_responses ar JOIN applications a ON a.id = ar.application_id
                 WHERE ar.user_id = u.id AND ar.status <> 'draft' AND a.type = 'mentor'
                ) THEN 'mentor'
                WHEN EXISTS (
                  SELECT 1 FROM application_responses ar JOIN applications a ON a.id = ar.application_id
                 WHERE ar.user_id = u.id AND ar.status <> 'draft' AND a.type = 'participant'
                ) THEN 'participant'
                ELSE 'unassigned'
              END AS role,
              EXISTS (
                SELECT 1 FROM application_responses ar
                 WHERE ar.user_id = u.id AND ar.status = 'confirmed'
              ) AS confirmed
         FROM users u
         LEFT JOIN user_caps uc ON uc.user_id = u.id
        WHERE u.anonymized_at IS NULL
     )
     SELECT role,
            count(*) FILTER (WHERE role IN ('staff', 'admin', 'sponsor') OR confirmed)::int AS eligible,
            count(*) FILTER (WHERE badge_id IS NOT NULL)::int AS accredited,
            array_agg(id) AS user_ids
       FROM classified
      GROUP BY role
      ORDER BY role`,
  );

  const occ = await occupancyEstimate();
  const present = new Set(occ.present);

  return rows.map((row) => ({
    role: row.role,
    eligible: row.eligible,
    accredited: row.accredited,
    inside: row.user_ids.filter((id) => present.has(id)).length,
  }));
}
