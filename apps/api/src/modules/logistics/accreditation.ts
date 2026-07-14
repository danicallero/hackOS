import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { loadPersonCard } from "./cards.js";
import { enqueueWalletSync } from "./wallet-sync.js";

/** Postgres unique_violation — thrown by the unique `users.badge_id` index. */
const PG_UNIQUE_VIOLATION = "23505";

export type CheckInMethod = "qr" | "manual" | "nfc";

// ── H22: lookup by ticket ─────────────────────────────────────────────────

/**
 * Resolve an entrance-QR ticket token to the person card staff needs to
 * accredit: name, confirmed-spot flag, intolerances, notes, and whether they
 * are already accredited (with the current badge). Never a mutation.
 */
export async function lookupByTicket(token: string) {
  const t = await pool.query(`SELECT user_id FROM tickets WHERE token = $1`, [token]);
  if (!t.rows[0]) throw new NotFoundError("Ticket not recognized"); // names no personal data
  return lookupByUserId(t.rows[0].user_id as number);
}

export async function lookupByUserId(userId: number) {
  const card = await loadPersonCard(pool, userId);
  // Identity-verification fields staff needs at the door (H22): the badge is
  // handed to a physical person, so the card carries DNI, email and shirt
  // size on top of the shared scanner card.
  const u = await pool.query(
    `SELECT badge_id, email, dni, phone, shirt_size FROM users WHERE id = $1`,
    [userId],
  );
  const row = u.rows[0] ?? {};
  const badge = (row.badge_id ?? null) as string | null;
  const confirmed = await pool.query(
    `SELECT 1 FROM application_responses WHERE user_id = $1 AND status = 'confirmed' LIMIT 1`,
    [userId],
  );

  return {
    ...card,
    email: (row.email ?? null) as string | null,
    dni: (row.dni ?? null) as string | null,
    phone: (row.phone ?? null) as string | null,
    shirtSize: (row.shirt_size ?? null) as string | null,
    confirmed: confirmed.rows.length > 0,
    hasTicket: await hasTicket(userId),
    alreadyAccredited: badge != null,
    currentBadge: badge,
  };
}

// ── H22/H23: unified person search ────────────────────────────────────────

export type AccreditationMatch = "ticket" | "badge" | "badge_history" | "profile";

export interface AccreditationSearchResult {
  userId: number;
  name: string | null;
  surname: string | null;
  email: string;
  badgeId: string | null;
  confirmed: boolean;
  matchedBy: AccreditationMatch;
}

/**
 * One search box for the accreditation desk: `q` is tried as an exact ticket
 * token, then as an exact badge id (current or rotated-away), and finally as
 * a name/surname/email substring. Exact identifier hits short-circuit the
 * fuzzy search so a scanned QR always resolves to exactly one person.
 * Read-only; guarded by ACCREDIT_SCAN (staff at the desk may lack users:list).
 */
export async function searchPeople(q: string): Promise<AccreditationSearchResult[]> {
  const needle = q.trim();
  if (!needle) return [];

  const ticket = await pool.query(`SELECT user_id FROM tickets WHERE token = $1`, [needle]);
  if (ticket.rows[0]) {
    return loadSearchResults([ticket.rows[0].user_id as number], "ticket");
  }

  const badge = await pool.query(`SELECT id FROM users WHERE badge_id = $1`, [needle]);
  if (badge.rows[0]) {
    return loadSearchResults([badge.rows[0].id as number], "badge");
  }

  const history = await pool.query(`SELECT id FROM users WHERE $1 = ANY(badge_id_history)`, [
    needle,
  ]);
  if (history.rows.length > 0) {
    return loadSearchResults(
      history.rows.map((r: { id: number }) => r.id),
      "badge_history",
    );
  }

  const like = `%${needle}%`;
  const fuzzy = await pool.query(
    `SELECT id FROM users
      WHERE name ILIKE $1 OR surname ILIKE $1 OR (name || ' ' || surname) ILIKE $1 OR email ILIKE $1
      ORDER BY surname NULLS LAST, name NULLS LAST, id
      LIMIT 10`,
    [like],
  );
  return loadSearchResults(
    fuzzy.rows.map((r: { id: number }) => r.id),
    "profile",
  );
}

async function loadSearchResults(
  userIds: number[],
  matchedBy: AccreditationMatch,
): Promise<AccreditationSearchResult[]> {
  if (userIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.surname, u.email, u.badge_id,
            EXISTS (
              SELECT 1 FROM application_responses ar
               WHERE ar.user_id = u.id AND ar.status = 'confirmed'
            ) AS confirmed
       FROM users u
      WHERE u.id = ANY($1::int[])
      ORDER BY array_position($1::int[], u.id)`,
    [userIds],
  );
  return rows.map(
    (r: {
      id: number;
      name: string | null;
      surname: string | null;
      email: string;
      badge_id: string | null;
      confirmed: boolean;
    }) => ({
      userId: r.id,
      name: r.name,
      surname: r.surname,
      email: r.email,
      badgeId: r.badge_id,
      confirmed: r.confirmed,
      matchedBy,
    }),
  );
}

async function hasTicket(userId: number): Promise<boolean> {
  const ticket = await pool.query(`SELECT 1 FROM tickets WHERE user_id = $1`, [userId]);
  return ticket.rows.length > 0;
}

// ── H22: check-in (assign badge) ──────────────────────────────────────────

/**
 * Assign `badgeId` to the ticket's owner and write the check-in log, all in
 * one transaction. Server confirmation is the source of truth: the scanner
 * waits for this OK, and idempotency-key replays make its retries safe.
 *
 * Conflicts (409): the badge already belongs to someone else, or the user is
 * already accredited (returns their current badge so staff can resolve).
 */
export async function checkIn(
  actorId: number,
  input: { ticketToken: string; badgeId: string; method: CheckInMethod },
) {
  const t = await pool.query(`SELECT user_id FROM tickets WHERE token = $1`, [input.ticketToken]);
  if (!t.rows[0]) throw new NotFoundError("Ticket not recognized");
  return checkInUser(actorId, {
    userId: t.rows[0].user_id as number,
    badgeId: input.badgeId,
    method: input.method,
  });
}

export async function checkInUser(
  actorId: number,
  input: { userId: number; badgeId: string; method: CheckInMethod },
) {
  const result = await withTransaction(async (client) => {
    const u = await client.query(
      `SELECT id, badge_id, name, surname FROM users WHERE id = $1 FOR UPDATE`,
      [input.userId],
    );
    const user = u.rows[0];
    if (!user) throw new NotFoundError("User not found");
    if (user.badge_id) {
      throw new ConflictError("User already accredited", {
        userId: input.userId,
        currentBadge: user.badge_id,
      });
    }

    const owner = await client.query(`SELECT id FROM users WHERE badge_id = $1`, [input.badgeId]);
    if (owner.rows[0] && owner.rows[0].id !== input.userId) {
      throw new ConflictError("Badge already assigned to another user", { badgeId: input.badgeId });
    }

    try {
      await client.query(`UPDATE users SET badge_id = $1 WHERE id = $2`, [
        input.badgeId,
        input.userId,
      ]);
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError("Badge already assigned to another user", {
          badgeId: input.badgeId,
        });
      }
      throw err;
    }

    const cin = await client.query(
      `INSERT INTO check_in_logs (user_id, badge_id, check_in_method, staff_id)
       VALUES ($1, $2, $3, $4) RETURNING id, checked_in_at`,
      [input.userId, input.badgeId, input.method, actorId],
    );

    await audit(client, {
      actorId,
      entityType: "accreditation",
      entityId: input.userId,
      action: "check_in",
      after: { badgeId: input.badgeId, method: input.method },
    });

    return {
      userId: input.userId,
      badgeId: input.badgeId,
      method: input.method,
      checkInLogId: cin.rows[0].id,
      checkedInAt: cin.rows[0].checked_in_at,
      name: user.name,
      surname: user.surname,
    };
  });
  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_ACCREDITED, result);
  return result;
}

// ── H23: badge rotation ───────────────────────────────────────────────────

/**
 * Rotate a lost badge: the old id is appended to `badge_id_history` (so later
 * scans of it return "badge revoked"), the new one becomes active, and any
 * Apple/Google badge passes are voided (H28 hook). 409 if the new badge is
 * already assigned. Before/after audited.
 */
export async function rotateBadge(
  actorId: number,
  input: { userId?: number; currentBadgeId?: string; newBadgeId: string; reason: string },
) {
  let voidedPassIds: number[] = [];
  const result = await withTransaction(async (client) => {
    let userId = input.userId ?? null;
    if (userId == null) {
      const r = await client.query(`SELECT id FROM users WHERE badge_id = $1`, [
        input.currentBadgeId,
      ]);
      if (!r.rows[0]) throw new NotFoundError("No user holds that badge");
      userId = r.rows[0].id as number;
    }

    const u = await client.query(
      `SELECT id, badge_id, badge_id_history FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (!u.rows[0]) throw new NotFoundError("User not found");
    const user = u.rows[0];
    const oldBadge = user.badge_id as string | null;

    const owner = await client.query(`SELECT id FROM users WHERE badge_id = $1`, [
      input.newBadgeId,
    ]);
    if (owner.rows[0] && owner.rows[0].id !== userId) {
      throw new ConflictError("New badge already assigned to another user", {
        badgeId: input.newBadgeId,
      });
    }

    const history: string[] = oldBadge
      ? [...(user.badge_id_history ?? []), oldBadge]
      : (user.badge_id_history ?? []);

    try {
      await client.query(`UPDATE users SET badge_id = $1, badge_id_history = $2 WHERE id = $3`, [
        input.newBadgeId,
        history,
        userId,
      ]);
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError("New badge already assigned to another user", {
          badgeId: input.newBadgeId,
        });
      }
      throw err;
    }

    // H28: badge passes are voided on rotation, both Apple and Google (not
    // filtered by platform), and pushed to their devices after commit below.
    const voided = await client.query(
      `UPDATE wallet_passes
          SET status = 'voided', last_updated_at = now(), update_tag = extract(epoch from now())::text
        WHERE user_id = $1 AND purpose = 'badge' AND status <> 'voided' RETURNING id`,
      [userId],
    );
    voidedPassIds = voided.rows.map((r: { id: number }) => r.id);

    await audit(client, {
      actorId,
      entityType: "badge",
      entityId: userId,
      action: "rotate",
      before: { badge_id: oldBadge },
      after: { badge_id: input.newBadgeId },
      reason: input.reason,
    });

    return {
      userId,
      oldBadge,
      newBadge: input.newBadgeId,
      voidedPasses: voided.rowCount ?? 0,
    };
  });
  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_BADGE_ROTATED, result);
  await broadcast(
    `${SSE_TOPICS.USER_PREFIX}${result.userId}`,
    EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
    {
      purpose: "badge",
      status: "voided",
    },
  );
  await enqueueWalletSync(voidedPassIds);
  return result;
}
