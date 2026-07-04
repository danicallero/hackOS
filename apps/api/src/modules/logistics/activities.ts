import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { AppError, BadRequestError, NotFoundError } from "../../lib/errors.js";
import { resolveByBadge } from "./badge.js";
import { loadPersonCard, type PersonCard } from "./cards.js";

interface ScanResult {
  status: number;
  body: {
    registered: boolean;
    firstTime: boolean;
    repeat: boolean;
    timesEaten: number;
    card: PersonCard;
    message?: string;
  };
}

// ── H25 meals / H26 registrable activities: scan a badge ──────────────────

/**
 * Scan a badge at a meal (category='meal') or any requires_scan activity
 * (H25, H26).
 *
 * - First scan auto-registers and reports firstTime.
 * - Meals require a `meal_entitlements` row; missing → explicit not_entitled
 *   error that still carries the person card so staff can resolve.
 * - A meal already served does NOT re-register: returns a 409 "repeat" payload
 *   requiring explicit confirmation; re-scanning with allowRepeat=true
 *   registers the repetition, audited as a staff override.
 * - Non-meal activities simply log every scan (repeats flagged, no confirm).
 *
 * Concurrency: a per (user, activity) advisory xact lock serializes parallel
 * scanners so two simultaneous first-time scans produce exactly one row.
 */
export async function activityScan(
  actorId: number,
  activityId: number,
  input: { badgeId: string; allowRepeat: boolean },
): Promise<ScanResult> {
  const act = await pool.query(`SELECT id, category, requires_scan FROM activities WHERE id = $1`, [
    activityId,
  ]);
  if (!act.rows[0]) throw new NotFoundError("Activity not found");
  const isMeal = act.rows[0].category === "meal";
  if (!isMeal && !act.rows[0].requires_scan) {
    throw new BadRequestError("Activity is not scannable", { activityId });
  }

  const userId = await resolveByBadge(pool, input.badgeId);

  return withTransaction(async (client) => {
    // Serialize concurrent scans of the same person+activity (H25 concurrency).
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [userId, activityId]);

    const card = await loadPersonCard(client, userId);

    if (isMeal) {
      const ent = await client.query(
        `SELECT 1 FROM meal_entitlements WHERE user_id = $1 AND activity_id = $2`,
        [userId, activityId],
      );
      if (!ent.rows[0]) {
        // Still shows the name so staff can resolve (H25).
        throw new AppError(409, "not_entitled", "Not entitled to this meal", { card });
      }
    }

    const cnt = await client.query(
      `SELECT count(*)::int AS n FROM activity_logs WHERE user_id = $1 AND activity_id = $2`,
      [userId, activityId],
    );
    const timesBefore = cnt.rows[0].n as number;
    const firstTime = timesBefore === 0;

    if (!firstTime && isMeal && !input.allowRepeat) {
      // Repeat needs explicit confirmation — do NOT register.
      return {
        status: 409,
        body: {
          registered: false,
          firstTime: false,
          repeat: true,
          timesEaten: timesBefore,
          card,
          message: "Already served; re-scan with allowRepeat to register a repetition",
        },
      };
    }

    await client.query(
      `INSERT INTO activity_logs (user_id, activity_id, logged_by) VALUES ($1, $2, $3)`,
      [userId, activityId, actorId],
    );

    if (!firstTime && isMeal) {
      // Staff override for a meal repetition is audited (H25).
      await audit(client, {
        actorId,
        entityType: "meal",
        entityId: userId,
        action: "repeat_override",
        after: { activityId, timesEaten: timesBefore + 1 },
      });
    }

    return {
      status: 200,
      body: {
        registered: true,
        firstTime,
        repeat: !firstTime,
        timesEaten: timesBefore + 1,
        card,
      },
    };
  });
}

// ── H25 entitlement admin (capability SCHEDULE_MANAGE) ────────────────────

export async function grantEntitlement(actorId: number, activityId: number, userId: number) {
  return withTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO meal_entitlements (user_id, activity_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING user_id`,
      [userId, activityId],
    );
    const granted = r.rowCount === 1;
    if (granted) {
      await audit(client, {
        actorId,
        entityType: "meal_entitlement",
        entityId: `${userId}:${activityId}`,
        action: "grant",
        after: { userId, activityId },
      });
    }
    return { userId, activityId, granted };
  });
}

export async function revokeEntitlement(actorId: number, activityId: number, userId: number) {
  return withTransaction(async (client) => {
    const r = await client.query(
      `DELETE FROM meal_entitlements WHERE user_id = $1 AND activity_id = $2 RETURNING user_id`,
      [userId, activityId],
    );
    const revoked = (r.rowCount ?? 0) === 1;
    if (revoked) {
      await audit(client, {
        actorId,
        entityType: "meal_entitlement",
        entityId: `${userId}:${activityId}`,
        action: "revoke",
        before: { userId, activityId },
      });
    }
    return { userId, activityId, revoked };
  });
}

/** Bulk-grant an entitlement to every confirmed participant (H25). */
export async function bulkGrantConfirmed(actorId: number, activityId: number) {
  return withTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO meal_entitlements (user_id, activity_id)
       SELECT DISTINCT ar.user_id, $1::int FROM application_responses ar WHERE ar.status = 'confirmed'
       ON CONFLICT DO NOTHING RETURNING user_id`,
      [activityId],
    );
    const granted = r.rowCount ?? 0;
    await audit(client, {
      actorId,
      entityType: "meal_entitlement",
      entityId: `bulk:${activityId}`,
      action: "bulk_grant_confirmed",
      after: { activityId, granted },
    });
    return { activityId, granted };
  });
}
