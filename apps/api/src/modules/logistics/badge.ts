import type { Queryable } from "../../db/pool.js";
import { AppError } from "../../lib/errors.js";
import { scannerCredentialDigest } from "./credential-tombstones.js";

/**
 * H23/H54: an offline scan is evidence from the physical credential that was
 * current when it was recorded. Once that credential is replaced, an event
 * timestamp before the replacement cannot be accepted under the new badge's
 * identity. The assignment timestamp is intentionally not exposed to clients.
 */
export function assertBadgeScanTimestamp(
  scannedAt: Date | undefined,
  badgeAssignedAt: Date | null | undefined,
): void {
  if (scannedAt == null || badgeAssignedAt == null) return;
  if (scannedAt.getTime() < badgeAssignedAt.getTime()) {
    throw new AppError(
      409,
      "badge_scan_before_assignment",
      "Offline scan predates the current badge assignment",
    );
  }
}

/**
 * Resolve a scanned badge to its CURRENT owner (H23). Only `users.badge_id`
 * matches — a badge that was rotated away lives in `badge_id_history` and is
 * explicitly revoked; an unknown badge is unknown. Neither error names any
 * personal data (plan/07: rotated-away scan returns a bare "badge revoked").
 */
export async function resolveByBadge(
  db: Queryable,
  badgeId: string,
  options: { allowPendingExit?: boolean } = {},
): Promise<number> {
  // Reject the permanent, unlinked retirement tombstone before resolving the
  // current owner so a disconnected scanner cannot replay an old
  // identity-bearing scan against the replacement participant (H54). The
  // central table stores only a keyed digest; physical badge reuse still
  // requires assignment binding and is a separate release decision.
  const tombstone = await db.query(
    `SELECT 1 FROM scanner_revoked_badges
      WHERE credential_digest = $1
      AND (expires_at IS NULL OR expires_at > clock_timestamp())
      LIMIT 1`,
    [scannerCredentialDigest("badge", badgeId)],
  );
  if (tombstone.rows[0]) {
    throw new AppError(409, "badge_revoked", "This badge has been revoked");
  }

  const current = await db.query(
    `SELECT id FROM users
      WHERE badge_id = $1
        AND anonymized_at IS NULL
        AND (
          account_state = 'active'
          OR ($2::boolean AND account_state = 'removal_pending' AND removal_requires_exit = true)
        )`,
    [badgeId, options.allowPendingExit === true],
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
