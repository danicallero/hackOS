import { ERROR_REASONS } from "@hackos/shared/error-reasons";
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
  // central table stores only a keyed digest. Ordinary physical badge reuse
  // is governed by the server-side assignment timestamp fence; a credential
  // retired with an account is never reused.
  const tombstone = await db.query(
    `SELECT 1 FROM scanner_revoked_badges
      WHERE credential_digest = $1
      LIMIT 1`,
    [scannerCredentialDigest("badge", badgeId)],
  );
  if (tombstone.rows[0]) {
    throw new AppError(409, "badge_revoked", "This badge has been revoked", {
      code: ERROR_REASONS.BADGE_REVOKED,
    });
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
  if (revoked.rows[0])
    throw new AppError(409, "badge_revoked", "This badge has been revoked", {
      code: ERROR_REASONS.BADGE_REVOKED,
    });

  throw new AppError(404, "badge_unknown", "Badge not recognized");
}

/**
 * Set-based `resolveByBadge` (H23/H54) for offline batches: three queries
 * regardless of batch size, same tombstone -> current owner -> revoked ->
 * unknown precedence per badge. Returns each badge's owner id, or the
 * AppError `resolveByBadge` would have thrown, so callers can keep their own
 * per-badge error precedence across later validation stages.
 */
export async function resolveByBadges(
  db: Queryable,
  badgeIds: string[],
): Promise<Map<string, number | AppError>> {
  const out = new Map<string, number | AppError>();
  if (badgeIds.length === 0) return out;
  const revokedError = () =>
    new AppError(409, "badge_revoked", "This badge has been revoked", {
      code: ERROR_REASONS.BADGE_REVOKED,
    });

  const digests = badgeIds.map((badgeId) => scannerCredentialDigest("badge", badgeId));
  const tombstones = await db.query<{ credential_digest: string }>(
    `SELECT credential_digest FROM scanner_revoked_badges
      WHERE credential_digest = ANY($1::text[])`,
    [digests],
  );
  const tombstoned = new Set(tombstones.rows.map((r) => r.credential_digest));

  const current = await db.query<{ id: number; badge_id: string }>(
    `SELECT id, badge_id FROM users
      WHERE badge_id = ANY($1::text[])
        AND anonymized_at IS NULL
        AND account_state = 'active'`,
    [badgeIds],
  );
  const owners = new Map(current.rows.map((r) => [r.badge_id, r.id]));

  const revoked = await db.query<{ badge_id: string }>(
    `SELECT b AS badge_id FROM unnest($1::text[]) AS b
      WHERE EXISTS (
        SELECT 1 FROM users
         WHERE b = ANY(badge_id_history)
            OR (badge_id = b AND account_state = 'removal_pending')
      )`,
    [badgeIds],
  );
  const revokedIds = new Set(revoked.rows.map((r) => r.badge_id));

  badgeIds.forEach((badgeId, i) => {
    const owner = owners.get(badgeId);
    if (tombstoned.has(digests[i] as string)) out.set(badgeId, revokedError());
    else if (owner != null) out.set(badgeId, owner);
    else if (revokedIds.has(badgeId)) out.set(badgeId, revokedError());
    else out.set(badgeId, new AppError(404, "badge_unknown", "Badge not recognized"));
  });
  return out;
}
