import { pool } from "../../db/pool.js";

/**
 * H22-H26 scanner seed/sync payload. Native scanners keep this deliberately
 * small dataset in SQLite: identity/card data needed at the point of scan,
 * current and revoked badge mappings, scannable activities and per-person
 * scan counts. Mutations still go through the existing server
 * endpoints and are replayed with Idempotency-Key headers.
 *
 * The payload is a full snapshot rather than a cursor delta. Badge history has
 * no per-value timestamp, and treating the response as replace-all makes a
 * missed sync harmless: every successful refresh converges to server truth.
 */
export async function scannerSnapshot() {
  const [peopleResult, activitiesResult, statesResult] = await Promise.all([
    pool.query(
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
       )
       SELECT u.id, u.email, u.name, u.surname, u.badge_id, u.badge_id_history,
              u.food_intolerance_notes, u.notes, t.token AS ticket_token,
              CASE
                WHEN COALESCE(uc.is_admin, false) THEN 'admin'
                WHEN EXISTS (SELECT 1 FROM room_judges rj WHERE rj.user_id = u.id) THEN 'judge'
                WHEN EXISTS (SELECT 1 FROM sponsors s WHERE s.user_id = u.id) THEN 'sponsor'
                WHEN COALESCE(uc.has_capability, false) THEN 'staff'
                ELSE 'participant'
              END AS role,
              EXISTS (
                SELECT 1 FROM application_responses ar
                 WHERE ar.user_id = u.id
                   AND ar.status IN ('accepted_internal', 'accepted', 'confirmed')
              ) AS accepted,
              EXISTS (
                SELECT 1 FROM application_responses ar
                 WHERE ar.user_id = u.id AND ar.status = 'confirmed'
              ) AS confirmed,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', fi.id, 'label', fi.label) ORDER BY fi.id)
                  FROM food_intolerances fi
                 WHERE fi.id = ANY(u.food_intolerances)
              ), '[]'::jsonb) AS intolerances,
              last_presence.kind AS last_presence_kind,
              last_presence.scanned_at AS last_presence_at
         FROM users u
         LEFT JOIN user_caps uc ON uc.user_id = u.id
         LEFT JOIN tickets t ON t.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT tl.kind, tl.scanned_at
             FROM time_logs tl
            WHERE tl.user_id = u.id
            ORDER BY tl.scanned_at DESC, tl.id DESC
            LIMIT 1
         ) last_presence ON true
        ORDER BY u.id`,
    ),
    pool.query(
      `SELECT id, name, category, requires_scan
         FROM activities
        WHERE category = 'meal' OR requires_scan = true
        ORDER BY name ASC, id ASC`,
    ),
    pool.query(
      `SELECT user_id, activity_id, count(*)::int AS scan_count
         FROM activity_logs GROUP BY user_id, activity_id`,
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    people: peopleResult.rows.map((row) => ({
      userId: row.id as number,
      email: row.email as string,
      role: row.role as "admin" | "judge" | "sponsor" | "staff" | "participant",
      ticketToken: (row.ticket_token as string | null) ?? null,
      badgeId: (row.badge_id as string | null) ?? null,
      revokedBadgeIds: (row.badge_id_history as string[]) ?? [],
      name: (row.name as string | null) ?? null,
      surname: (row.surname as string | null) ?? null,
      accepted: Boolean(row.accepted),
      confirmed: Boolean(row.confirmed),
      intolerances: row.intolerances as Array<{ id: number; label: Record<string, string> }>,
      foodIntoleranceNotes: (row.food_intolerance_notes as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      lastPresenceKind: (row.last_presence_kind as "in" | "out" | null) ?? null,
      lastPresenceAt:
        row.last_presence_at instanceof Date ? row.last_presence_at.toISOString() : null,
    })),
    activities: activitiesResult.rows.map((row) => ({
      id: row.id as number,
      name: row.name as string,
      category: row.category as string,
      requiresScan: Boolean(row.requires_scan),
    })),
    activityStates: statesResult.rows.map((row) => ({
      userId: row.user_id as number,
      activityId: row.activity_id as number,
      count: row.scan_count as number,
    })),
  };
}
