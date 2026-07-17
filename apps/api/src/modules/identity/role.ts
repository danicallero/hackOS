import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { Queryable } from "../../db/pool.js";
import { getEffectiveCapabilities } from "../../lib/capabilities.js";

/**
 * Illustrative role (0001 users table comment; plan/07 invariant 13: "rol
 * derivado de relaciones, no se guarda como verdad de permisos"). Display
 * only — never used for a permission check, which always goes through
 * requireCapability(). Priority: admin > judge > sponsor > staff >
 * participant.
 */
export type DerivedRole = "admin" | "judge" | "sponsor" | "staff" | "participant";

export async function computeDerivedRole(db: Queryable, userId: number): Promise<DerivedRole> {
  const capabilities = await getEffectiveCapabilities(userId);
  if (capabilities.has(CAPABILITIES.ADMIN_ALL)) return "admin";

  const { isRoomJudge, isSponsorRep } = await computeMembershipFlags(db, userId);
  if (isRoomJudge) return "judge";
  if (isSponsorRep) return "sponsor";

  // "any staff-ish capability" — anyone holding a capability at all is doing
  // *something* operational beyond being a plain participant.
  if (capabilities.size > 0) return "staff";

  return "participant";
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
