import { randomBytes } from "node:crypto";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

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

async function assertEntitled(userId: number, purpose: Purpose): Promise<void> {
  if (purpose === "ticket") {
    const t = await pool.query(`SELECT 1 FROM tickets WHERE user_id = $1`, [userId]);
    if (!t.rows[0]) throw new NotFoundError("Ticket not issued");
  } else {
    const b = await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [userId]);
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
    const existing = await client.query(
      `SELECT id, user_id, purpose, platform, serial_number, authentication_token,
              google_object_id, status, update_tag
         FROM wallet_passes
        WHERE user_id = $1 AND purpose = $2 AND platform = $3 AND status <> 'voided'
        FOR UPDATE`,
      [userId, purpose, platform],
    );
    if (existing.rows[0]) return existing.rows[0];

    const serial = `${purpose}-${userId}-${randomBytes(6).toString("hex")}`;
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
  const { rows } = await pool.query(
    `UPDATE wallet_passes SET update_tag = extract(epoch from now())::text
      WHERE platform = 'apple'
      RETURNING id`,
  );
  return rows.map((r: { id: number }) => r.id);
}
