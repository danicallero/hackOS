import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type { Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { isImplausiblyFuture } from "../../lib/clock.js";
import { AppError, ConflictError } from "../../lib/errors.js";
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
      WHERE credential_digest = $1 AND event_key = current_edition()
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
        AND badge_event_key = current_edition()
        AND anonymized_at IS NULL
        AND (
          account_state = 'active'
          OR ($2::boolean AND account_state = 'removal_pending' AND removal_requires_exit = true)
        )`,
    [badgeId, options.allowPendingExit === true],
  );
  if (current.rows[0]) return current.rows[0].id as number;

  const revoked = await db.query(
    `SELECT 1 WHERE EXISTS (
        SELECT 1 FROM badge_id_history h
         WHERE h.badge_id = $1 AND h.event_key = current_edition()
      ) OR EXISTS (
        SELECT 1 FROM users
         WHERE badge_id = $1 AND badge_event_key = current_edition()
           AND account_state = 'removal_pending'
      )`,
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
      WHERE credential_digest = ANY($1::text[]) AND event_key = current_edition()`,
    [digests],
  );
  const tombstoned = new Set(tombstones.rows.map((r) => r.credential_digest));

  const current = await db.query<{ id: number; badge_id: string }>(
    `SELECT id, badge_id FROM users
      WHERE badge_id = ANY($1::text[])
        AND badge_event_key = current_edition()
        AND anonymized_at IS NULL
        AND account_state = 'active'`,
    [badgeIds],
  );
  const owners = new Map(current.rows.map((r) => [r.badge_id, r.id]));

  const revoked = await db.query<{ badge_id: string }>(
    `SELECT b AS badge_id FROM unnest($1::text[]) AS b
      WHERE EXISTS (
        SELECT 1 FROM badge_id_history h
         WHERE h.badge_id = b AND h.event_key = current_edition()
      ) OR EXISTS (
        SELECT 1 FROM users
         WHERE badge_id = b AND badge_event_key = current_edition()
           AND account_state = 'removal_pending'
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

/** How far back an offline accreditation may claim it happened (a long offline stretch). */
const MAX_OFFLINE_ASSIGNMENT_AGE_MS = 72 * 60 * 60 * 1000;

/**
 * H54 (DELTA): an accreditation recorded offline carries the time the operator
 * assigned the badge. Pins `users.badge_assigned_at` to it for the current
 * transaction (read by `h54_set_badge_assigned_at`) so scans taken with the badge
 * in between are not rejected as predating the assignment. Never in the future,
 * never before the previous assignment boundary, and bounded in age; anything
 * else is rejected so a client cannot backdate a badge to legitimise old scans.
 */
export async function pinBadgeAssignmentTime(
  client: Queryable,
  assignedAt: Date | undefined,
  previousAssignedAt: Date | null | undefined,
): Promise<void> {
  if (assignedAt == null) return;
  const tooOld = Date.now() - assignedAt.getTime() > MAX_OFFLINE_ASSIGNMENT_AGE_MS;
  const beforePrevious =
    previousAssignedAt != null && assignedAt.getTime() < previousAssignedAt.getTime();
  if (isImplausiblyFuture(assignedAt) || tooOld || beforePrevious) {
    throw new AppError(
      400,
      "badge_assignment_time_invalid",
      "The recorded badge assignment time is not plausible",
    );
  }
  await client.query(`SELECT set_config('hackos.badge_assigned_at', $1, true)`, [
    assignedAt.toISOString(),
  ]);
}

/**
 * Releases a rotated-away or removed badge into the edition-scoped history
 * (H23, multi-edition plan §9). The history row carries the edition of the
 * assignment being released, which may be a closed edition, so the insert
 * runs with closed-edition writes allowed and the previous setting restored.
 */
export async function recordReleasedBadge(
  client: Queryable,
  userId: number,
  badgeId: string,
  editionKey: string,
): Promise<void> {
  const prev = await client.query<{ value: string | null }>(
    `SELECT current_setting('hackos.edition_write_override', true) AS value`,
  );
  await client.query(`SELECT set_config('hackos.edition_write_override', 'on', true)`);
  try {
    await client.query(
      `INSERT INTO badge_id_history (user_id, badge_id, event_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, badge_id, event_key) DO UPDATE SET released_at = now()`,
      [userId, badgeId, editionKey],
    );
  } finally {
    await client.query(`SELECT set_config('hackos.edition_write_override', $1, true)`, [
      prev.rows[0]?.value ?? "",
    ]);
  }
}

/**
 * A physical code has one holder at a time (H22/H23, multi-edition plan §9).
 * Before assigning `badgeId` to `userId`: a holder of the CURRENT edition
 * blocks the assignment; a holder from a previous edition is released (the
 * code moves to the new person, the old edition keeps its history row) and
 * the current edition's retired-credential row for the code is lifted, all in
 * the caller's transaction and audited (H53). Call with the target user row
 * already locked.
 */
export async function claimBadgeCode(
  client: Queryable,
  actorId: number,
  userId: number,
  badgeId: string,
  conflictMessage: string,
): Promise<void> {
  const { rows } = await client.query<{
    id: number;
    badge_event_key: string;
    in_current_edition: boolean;
  }>(
    `SELECT id, badge_event_key, badge_event_key = current_edition() AS in_current_edition
       FROM users WHERE badge_id = $1 FOR UPDATE`,
    [badgeId],
  );
  const holder = rows[0];
  if (!holder || holder.id === userId) return;
  if (holder.in_current_edition) {
    throw new ConflictError(conflictMessage, { badgeId });
  }
  await client.query(`UPDATE users SET badge_id = NULL WHERE id = $1`, [holder.id]);
  await recordReleasedBadge(client, holder.id, badgeId, holder.badge_event_key);
  await client.query(
    `DELETE FROM scanner_revoked_badges
      WHERE credential_digest = $1 AND event_key = current_edition()`,
    [scannerCredentialDigest("badge", badgeId)],
  );
  await audit(client, {
    actorId,
    entityType: "badge",
    entityId: holder.id,
    action: "reassign_released",
    before: { badge_id: badgeId, event_key: holder.badge_event_key },
    after: { badge_id: null, reassigned_to: userId },
  });
}
