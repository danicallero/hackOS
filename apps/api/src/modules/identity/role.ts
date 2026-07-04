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

  const { rows: judgeRows } = await db.query(
    `SELECT 1 FROM room_judges WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (judgeRows.length > 0) return "judge";

  const { rows: sponsorRows } = await db.query(
    `SELECT 1 FROM sponsors WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (sponsorRows.length > 0) return "sponsor";

  // "any staff-ish capability" — anyone holding a capability at all is doing
  // *something* operational beyond being a plain participant.
  if (capabilities.size > 0) return "staff";

  return "participant";
}
