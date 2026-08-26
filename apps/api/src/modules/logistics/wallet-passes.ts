import { randomBytes } from "node:crypto";
import type pg from "pg";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { hasEventAccess } from "../identity/role.js";

/**
 * Shared `wallet_passes` bookkeeping for both providers (H28). Apple and
 * Google issue their pass content very differently, but "does this user
 * still qualify" and "reuse the active row or issue a fresh one, audited"
 * are identical — factored out so the two provider modules don't duplicate
 * the SELECT ... FOR UPDATE / INSERT / audit dance.
 */

export type Purpose = "ticket" | "badge";
export type Platform = "apple" | "google";

export interface PassRow {
  id: number;
  user_id: number;
  purpose: Purpose;
  platform: Platform;
  serial_number: string;
  authentication_token: string;
  google_object_id: string | null;
  status: string;
  update_tag: string;
}

export interface PassIdentity {
  fullName: string;
  barcode: string;
}

export function resolvePassIdentity(
  user: {
    name: string | null;
    surname: string | null;
    badge_id: string | null;
    token: string | null;
  },
  userId: number,
  purpose: Purpose,
): PassIdentity {
  const fullName = [user.name, user.surname].filter(Boolean).join(" ") || `User ${userId}`;
  const barcode = purpose === "ticket" ? user.token : user.badge_id;
  return { fullName, barcode: barcode ?? "" };
}

async function assertEntitled(userId: number, purpose: Purpose): Promise<void> {
  if (purpose === "ticket") {
    // Not a mere row check: `tickets` is permanent once issued (plan/07
    // invariant 10), so re-issuing/refreshing a wallet pass must instead gate
    // on whether the person currently holds real event access.
    if (!(await hasEventAccess(pool, userId))) throw new NotFoundError("Ticket not issued");
  } else {
    const b = await pool.query(
      `SELECT badge_id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
      [userId],
    );
    if (!b.rows[0]) throw new NotFoundError("User not found");
    if (!b.rows[0].badge_id) throw new BadRequestError("Badge not assigned");
  }
}

/**
 * Returns the active pass row for (user, purpose, platform), issuing a fresh
 * one if none exists (the previous one may be `voided`, e.g. after badge
 * rotation — the partial unique index in 0500_logistics_offline_wallet_delta
 * allows exactly one non-voided row per (user, purpose, platform)).
 */
export async function ensurePassRecord(
  userId: number,
  purpose: Purpose,
  platform: Platform,
  opts?: { googleObjectId?: string },
): Promise<PassRow> {
  await assertEntitled(userId, purpose);

  return withTransaction(async (client) => {
    // H54: serialize pass issuance with account removal. The preflight above
    // is only advisory; this row lock is the authoritative state check.
    const activeUser = await client.query(
      `SELECT 1 FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!activeUser.rows[0]) throw new NotFoundError("User not found");
    const existing = await client.query(
      `SELECT id, user_id, purpose, platform, serial_number, authentication_token,
              google_object_id, status, update_tag
         FROM wallet_passes
        WHERE user_id = $1 AND purpose = $2 AND platform = $3 AND status <> 'voided'
        FOR UPDATE`,
      [userId, purpose, platform],
    );
    if (existing.rows[0]) return existing.rows[0];

    // The serial is copied to an installed Wallet pass and may outlive the
    // database row. Never encode the internal user id in that external
    // identifier (H54); the random suffix is the only account correlation.
    const serial = `${purpose}-${randomBytes(16).toString("hex")}`;
    const auth = randomBytes(24).toString("base64url");
    const googleObjectId = opts?.googleObjectId ?? null;
    const created = await client.query(
      `INSERT INTO wallet_passes
         (user_id, purpose, platform, serial_number, authentication_token, google_object_id, update_tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, purpose, platform, serial_number, authentication_token,
                 google_object_id, status, update_tag`,
      [userId, purpose, platform, serial, auth, googleObjectId, Date.now().toString()],
    );
    await audit(client, {
      actorId: userId,
      entityType: "wallet_pass",
      entityId: created.rows[0].id,
      action: "issued",
      after: { purpose, platform, serialNumber: serial, googleObjectId },
    });
    return created.rows[0];
  });
}

/**
 * Bumps every Apple pass's update_tag so `appleChangedSerials` reports them
 * changed on Wallet's next poll. Pass content (event name, venue, back
 * fields, ...) is regenerated fresh from the DB on every fetch (`wallet.ts`'s
 * `passPayload`), so bumping the tag is the only state change needed — the
 * caller still has to push (`enqueueWalletSync`) so devices refetch promptly
 * instead of waiting for their next scheduled poll. Includes voided passes:
 * they're still servable via the webservice re-fetch path and should reflect
 * up-to-date content too.
 */
export async function bumpAllAppleWalletUpdateTags(): Promise<number[]> {
  // Canonical update_tag format is integer epoch milliseconds (0504) — must
  // match ensurePassRecord's Date.now() so appleChangedSerials compares a
  // single format.
  const { rows } = await pool.query(
    `UPDATE wallet_passes SET update_tag = ((extract(epoch FROM now()) * 1000)::bigint)::text
      WHERE platform = 'apple'
      RETURNING id`,
  );
  return rows.map((r: { id: number }) => r.id);
}

/**
 * Voids any active ticket-purpose wallet passes for a user who just lost
 * event access (declined/revoked after confirming) — mirrors
 * `voidBadgePasses` in `accreditation.ts`. The underlying `tickets` row is
 * untouched (plan/07 invariant 10); this only closes off the wallet pass
 * representation, which the caller then pushes to devices via
 * `enqueueWalletSync`.
 */
export async function voidTicketPasses(client: pg.PoolClient, userId: number): Promise<void> {
  await client.query(
    `UPDATE wallet_passes
        SET status = 'voided', last_updated_at = now(), update_tag = extract(epoch from now())::text
      WHERE user_id = $1 AND purpose = 'ticket' AND status <> 'voided'`,
    [userId],
  );
}
