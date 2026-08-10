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
  const capabilities = await getEffectiveCapabilities(userId);
  if (capabilities.has(CAPABILITIES.ADMIN_ALL)) return "admin";

  const { isRoomJudge, isSponsorRep } = await computeMembershipFlags(db, userId);
  if (isRoomJudge) return "judge";
  if (isSponsorRep) return "sponsor";

  // "any staff-ish capability" — anyone holding a capability at all is doing
  // *something* operational beyond being a plain participant.
  if (capabilities.size > 0) return "staff";

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
  return "unassigned";
}

/**
 * Association-based facts underlying the illustrative `role` above, exposed
 * independently so navigation (H8/H55, issue #187) can show every relevant
 * workspace for a multi-capability account instead of collapsing to one
 * illustrative label — a sponsor rep who is also a room judge needs both the
 * sponsor and judging workspaces, not whichever `role` wins priority.
 */
export async function computeMembershipFlags(
  db: Queryable,
  userId: number,
): Promise<{ isRoomJudge: boolean; isSponsorRep: boolean }> {
  const [{ rows: judgeRows }, { rows: sponsorRows }] = await Promise.all([
    db.query(`SELECT 1 FROM room_judges WHERE user_id = $1 LIMIT 1`, [userId]),
    db.query(`SELECT 1 FROM sponsors WHERE user_id = $1 LIMIT 1`, [userId]),
  ]);
  return { isRoomJudge: judgeRows.length > 0, isSponsorRep: sponsorRows.length > 0 };
}

/**
 * Whether this user currently holds real event access: a confirmed
 * application response, or a staff-assigned attendee role (mentor/participant
 * granted without going through the applications flow). User-level, not
 * response-level — declining one of several applications doesn't strip
 * access if another stays confirmed. Drives ticket/wallet exposure and
 * participant-only nav gating; the underlying `tickets` row is never touched
 * by this (plan/07 invariant 10: a ticket is neither consumed nor revoked).
 */
export async function hasEventAccess(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 WHERE EXISTS (
        SELECT 1 FROM application_responses WHERE user_id = $1 AND status = 'confirmed'
      ) OR EXISTS (
        SELECT 1 FROM manual_attendee_roles WHERE user_id = $1
      )`,
    [userId],
  );
  return rows.length > 0;
}
