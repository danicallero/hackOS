import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { Queryable } from "../../db/pool.js";
import { getEffectiveCapabilities } from "../../lib/capabilities.js";

/**
 * Illustrative role (0001 users table comment; plan/07 invariant 13: "rol
 * derivado de relaciones, no se guarda como verdad de permisos"). Display
 * only — never used for a permission check, which always goes through
 * requireCapability(). Priority: admin > judge > sponsor > staff >
 * mentor > participant > unassigned.
 */
export type DerivedRole =
  | "admin"
  | "judge"
  | "sponsor"
  | "staff"
  | "mentor"
  | "participant"
  | "unassigned";

export async function computeDerivedRole(db: Queryable, userId: number): Promise<DerivedRole> {
  const { rows: activeRows } = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  if (!activeRows[0]) return "unassigned";
  const capabilities = await getEffectiveCapabilities(userId);
  if (capabilities.has(CAPABILITIES.ADMIN_ALL)) return "admin";

  const { isEnterpriseJudge, isSponsorRep } = await computeMembershipFlags(db, userId);
  if (isEnterpriseJudge) return "judge";
  if (isSponsorRep) return "sponsor";

  // "any staff-ish capability" — anyone holding a capability at all is doing
  // *something* operational beyond being a plain participant.
  if (capabilities.size > 0) return "staff";

  const attendeeType = await mentorOrParticipantType(db, userId);
  return attendeeType ?? "unassigned";
}

/**
 * Whether this user is (manually assigned or self-applied as) a mentor or a
 * participant — extracted from computeDerivedRole so the schedule module's
 * audience resolution (H59: a schedule item's `participant`/`mentor`
 * audience toggles) can reuse the exact same lookup without duplicating the
 * manual-role/application-type SQL. Mutually exclusive, mentor takes
 * priority, matching computeDerivedRole's own priority order.
 */
export async function mentorOrParticipantType(
  db: Queryable,
  userId: number,
): Promise<"mentor" | "participant" | null> {
  const { rows: activeRows } = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  if (!activeRows[0]) return null;
  const manual = await db.query(`SELECT role FROM manual_attendee_roles WHERE user_id = $1`, [
    userId,
  ]);
  if (manual.rows[0]?.role === "mentor") return "mentor";
  if (manual.rows[0]?.role === "participant") return "participant";

  const { rows } = await db.query(
    `SELECT a.type
       FROM application_responses ar
       JOIN applications a ON a.id = ar.application_id
      WHERE ar.user_id = $1 AND ar.status <> 'draft'
        AND a.type IN ('mentor', 'participant')
      ORDER BY CASE a.type WHEN 'mentor' THEN 0 ELSE 1 END
      LIMIT 1`,
    [userId],
  );
  if (rows[0]?.type === "mentor") return "mentor";
  if (rows[0]?.type === "participant") return "participant";
  return null;
}

/**
 * H8's actual "public role" concept: the highest-position role among a
 * user's assigned roles that is marked `is_visible`, or null if they hold no
 * visible role. This is the literal Discord-style hierarchy answer — kept
 * separate from computeDerivedRole (whose fixed admin/judge/sponsor/staff/
 * mentor/participant/unassigned union many existing callers already switch
 * on) rather than replacing it, so nothing that reads DerivedRole breaks.
 */
export async function getHighestVisibleRoleName(
  db: Queryable,
  userId: number,
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.is_visible = true
      ORDER BY r.position DESC
      LIMIT 1`,
    [userId],
  );
  return (rows[0]?.name as string | undefined) ?? null;
}

export interface AssignedRoleSummary {
  id: number;
  name: string;
  position: number;
  isVisible: boolean;
}

/**
 * The user's complete assigned-role set (H8), highest position first — not
 * just the single displayed role `getHighestVisibleRoleName` returns above.
 * Used by /api/me and /api/users/:id to show a full role list alongside the
 * one prominent "displayed role" (issue: profile role-list display).
 */
export async function getAssignedRoles(
  db: Queryable,
  userId: number,
): Promise<AssignedRoleSummary[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.position, r.is_visible
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.deleted_at IS NULL
      ORDER BY r.position DESC`,
    [userId],
  );
  return rows.map((r: { id: number; name: string; position: number; is_visible: boolean }) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    isVisible: r.is_visible,
  }));
}

/**
 * Association-based facts underlying the illustrative `role` above, exposed
 * independently so navigation (H8/H55, issue #187) can show every relevant
 * workspace for a multi-capability account instead of collapsing to one
 * illustrative label — a sponsor rep who is also a judge needs both the
 * sponsor and judging workspaces, not whichever `role` wins priority.
 */
export async function computeMembershipFlags(
  db: Queryable,
  userId: number,
): Promise<{ isEnterpriseJudge: boolean; isSponsorRep: boolean }> {
  const [{ rows: judgeRows }, { rows: sponsorRows }] = await Promise.all([
    db.query(
      `SELECT 1 FROM enterprise_judges ej
        JOIN users u ON u.id = ej.user_id
       WHERE ej.user_id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
       LIMIT 1`,
      [userId],
    ),
    db.query(
      `SELECT 1 FROM sponsors s
        JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
       LIMIT 1`,
      [userId],
    ),
  ]);
  return { isEnterpriseJudge: judgeRows.length > 0, isSponsorRep: sponsorRows.length > 0 };
}

/**
 * Whether this user currently holds real event access: a confirmed
 * application response, a staff-assigned attendee role (mentor/participant
 * granted without going through the applications flow), a sponsor
 * representative membership, or any operational capability (admin/staff —
 * H43). User-level, not response-level — declining one of several
 * applications doesn't strip access if another stays confirmed, and it
 * doesn't strip access for an admin/staffer whose only other tie to the
 * event was an application they later rejected: capability holders keep
 * their ticket regardless of application status. Drives ticket/wallet
 * exposure and participant-only nav gating; the underlying `tickets` row is
 * never touched by this (plan/07 invariant 10: a ticket is neither consumed
 * nor revoked).
 */
export async function hasEventAccess(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM users u WHERE u.id = $1
      AND u.account_state = 'active' AND u.anonymized_at IS NULL
      AND (EXISTS (
        SELECT 1 FROM application_responses WHERE user_id = $1 AND status = 'confirmed'
      ) OR EXISTS (
        SELECT 1 FROM manual_attendee_roles WHERE user_id = $1
      ) OR EXISTS (
        SELECT 1 FROM sponsors WHERE user_id = $1
      ))`,
    [userId],
  );
  if (rows.length > 0) return true;
  const capabilities = await getEffectiveCapabilities(userId);
  return capabilities.size > 0;
}
