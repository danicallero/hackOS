import type { Queryable } from "../../db/pool.js";
import { AppError } from "../../lib/errors.js";

/**
 * Resolve a scanned badge to its CURRENT owner (H23). Only `users.badge_id`
 * matches — a badge that was rotated away lives in `badge_id_history` and is
 * explicitly revoked; an unknown badge is unknown. Neither error names any
 * personal data (plan/07: rotated-away scan returns a bare "badge revoked").
 */
export async function resolveByBadge(db: Queryable, badgeId: string): Promise<number> {
  const current = await db.query(
    `SELECT id FROM users
      WHERE badge_id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [badgeId],
  );
  if (current.rows[0]) return current.rows[0].id as number;

  const revoked = await db.query(
    `SELECT 1 FROM users
      WHERE $1 = ANY(badge_id_history)
         OR (badge_id = $1 AND account_state = 'removal_pending')
      LIMIT 1`,
    [badgeId],
  );
  if (revoked.rows[0]) throw new AppError(409, "badge_revoked", "This badge has been revoked");

  throw new AppError(404, "badge_unknown", "Badge not recognized");
}
