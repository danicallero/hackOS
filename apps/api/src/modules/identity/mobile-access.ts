import type { Queryable } from "../../db/pool.js";
import type { DerivedRole } from "./role.js";

/**
 * Mobile is an event-day surface, not an alternate application portal.
 * Access is limited to operational relationships, accepted/confirmed
 * applicants, and accounts explicitly created through an event invite.
 */
export async function hasMobileAccess(
  db: Queryable,
  userId: number,
  role: DerivedRole,
): Promise<boolean> {
  if (role !== "participant") return true;

  const { rows } = await db.query(
    `SELECT 1
       FROM application_responses r
      WHERE r.user_id = $1
        AND r.status IN ('accepted', 'confirmed')
     UNION ALL
     SELECT 1
       FROM email_verification_tokens t
      WHERE t.user_id = $1
        AND t.type IN ('account_claim', 'sponsor_invite')
        AND t.used_at IS NOT NULL
     LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}
