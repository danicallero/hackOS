import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type pg from "pg";
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

/** A ticket QR must never become a badge id — they identify different physical items (H22/H23). */
async function assertNotTicketToken(client: pg.PoolClient, badgeId: string): Promise<void> {
  const ticket = await client.query(`SELECT 1 FROM tickets WHERE token = $1`, [badgeId]);
  if (ticket.rows.length > 0) {
    throw new ConflictError("A ticket cannot be used as a badge", { badgeId });
  }
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

    await assertNotTicketToken(client, input.badgeId);

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

    // Optional event policy: accreditation is also the presence entry signal.
    // Early check-ins are scheduled for the configured common entry instant;
    // late check-ins use their real accreditation time.
    const automaticPresence = await client.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by, notes)
       SELECT $1, 'in', GREATEST($2::timestamptz, ec.presence_auto_entry_at), $3,
              'Automatic entry from accreditation'
         FROM event_config ec
        WHERE ec.id = 1
          AND ec.presence_auto_entry_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM time_logs WHERE user_id = $1)
       RETURNING scanned_at`,
      [input.userId, cin.rows[0].checked_in_at, actorId],
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
      presenceEntryAt: automaticPresence.rows[0]?.scanned_at ?? null,
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

    await assertNotTicketToken(client, input.newBadgeId);

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

/** Remove an active accreditation while keeping the old badge permanently revoked and audited. */
export async function removeBadge(actorId: number, input: { userId: number; reason: string }) {
  let voidedPassIds: number[] = [];
  const result = await withTransaction(async (client) => {
    const found = await client.query(
      `SELECT badge_id, badge_id_history FROM users WHERE id = $1 FOR UPDATE`,
      [input.userId],
    );
    if (!found.rows[0]) throw new NotFoundError("User not found");
    const oldBadge = (found.rows[0].badge_id ?? null) as string | null;
    if (!oldBadge) throw new ConflictError("User has no active badge", { userId: input.userId });
    const history = [...(found.rows[0].badge_id_history ?? []), oldBadge];
    await client.query(`UPDATE users SET badge_id = NULL, badge_id_history = $1 WHERE id = $2`, [
      history,
      input.userId,
    ]);
    const voided = await client.query(
      `UPDATE wallet_passes
          SET status = 'voided', last_updated_at = now(), update_tag = extract(epoch from now())::text
        WHERE user_id = $1 AND purpose = 'badge' AND status <> 'voided' RETURNING id`,
      [input.userId],
    );
    voidedPassIds = voided.rows.map((row: { id: number }) => row.id);
    await audit(client, {
      actorId,
      entityType: "badge",
      entityId: input.userId,
      action: "remove",
      before: { badge_id: oldBadge },
      after: { badge_id: null },
      reason: input.reason,
    });
    return { userId: input.userId, oldBadge, voidedPasses: voidedPassIds.length };
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
