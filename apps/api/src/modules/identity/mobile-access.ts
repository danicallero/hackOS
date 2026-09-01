import type { Queryable } from "../../db/pool.js";
import { getEffectiveCapabilities } from "../../lib/capabilities.js";
import { computeMembershipFlags } from "./role.js";

/**
 * Mobile is an event-day surface, not an alternate application portal.
 * Access is limited to operational relationships, accepted/confirmed
 * applicants, and accounts explicitly created through an event invite.
 *
 * H8 full-replacement: admin/staff used to be recognized via the retired
 * badge_category bucket; the underlying facts are a capability holder
 * (getEffectiveCapabilities) or an enterprise judge/sponsor rep
 * (computeMembershipFlags) — checked directly here instead of through a
 * re-derived role-name comparison. Applicant-derived roles (Mentor,
 * Participant, or no role at all) still require an accepted/confirmed
 * response.
 */
export async function hasMobileAccess(db: Queryable, userId: number): Promise<boolean> {
  const capabilities = await getEffectiveCapabilities(userId);
  if (capabilities.size > 0) return true;
  const { isEnterpriseJudge, isSponsorRep } = await computeMembershipFlags(db, userId);
  if (isEnterpriseJudge || isSponsorRep) return true;

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
