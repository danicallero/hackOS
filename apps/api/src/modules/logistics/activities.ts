import { isMealActivityKind } from "@hackos/shared/activity-kinds";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { isImplausiblyFuture } from "../../lib/clock.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { broadcastForActiveUser } from "./active-broadcast.js";
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
 * Scan a badge at a meal (a category the shared registry marks `scan: "meal"`)
 * or any requires_scan activity
 * (H25, H26).
 *
 * - Everyone has the right to eat: no entitlement check gates meal scans.
 * - First scan auto-registers and reports firstTime.
 * - Any repeated meal/activity does NOT re-register immediately: it returns a
 *   409 payload requiring explicit confirmation. Re-scanning with
 *   allowRepeat=true registers an audited staff override.
 *
 * Concurrency: a per (user, activity) advisory xact lock serializes parallel
 * scanners so two simultaneous first-time scans produce exactly one row.
 */
export async function activityScan(
  actorId: number | null,
  activityId: number,
  input: {
    badgeId: string;
    allowRepeat: boolean;
    scannedAt?: Date;
    sourceDeviceId?: string;
    sourceScanId?: string;
  },
): Promise<ScanResult> {
  const act = await pool.query(`SELECT id, category, requires_scan FROM activities WHERE id = $1`, [
    activityId,
  ]);
  if (!act.rows[0]) throw new NotFoundError("Activity not found");
  const isMeal = isMealActivityKind(act.rows[0].category);
  if (!isMeal && !act.rows[0].requires_scan) {
    throw new BadRequestError("Activity is not scannable", { activityId });
  }

  const userId = await resolveByBadge(pool, input.badgeId);
  if (input.scannedAt && isImplausiblyFuture(input.scannedAt)) {
    throw new BadRequestError("Offline scan timestamp must be in the past");
  }

  const result = await withTransaction(async (client) => {
    // Serialize concurrent scans of the same person+activity (H25 concurrency).
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [userId, activityId]);

    // Serialize with account removal. The badge lookup happened before the
    // transaction, so the row lock/state check is the authoritative decision
    // for a stale or offline scan that races anonymization.
    const activeUser = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!activeUser.rows[0]) throw new NotFoundError("Badge not recognized");

    const card = await loadPersonCard(client, userId);

    if (input.sourceDeviceId && input.sourceScanId) {
      const existing = await client.query(
        `SELECT 1 FROM activity_logs
          WHERE source_device_id = $1 AND source_scan_id = $2
          LIMIT 1`,
        [input.sourceDeviceId, input.sourceScanId],
      );
      if (existing.rows[0]) {
        const count = await client.query(
          `SELECT count(*)::int AS n FROM activity_logs WHERE user_id = $1 AND activity_id = $2`,
          [userId, activityId],
        );
        return {
          status: 200,
          body: {
            registered: true,
            firstTime: false,
            repeat: count.rows[0].n > 1,
            timesEaten: count.rows[0].n as number,
            card,
          },
        };
      }
    }

    const cnt = await client.query(
      `SELECT count(*)::int AS n FROM activity_logs WHERE user_id = $1 AND activity_id = $2`,
      [userId, activityId],
    );
    const timesBefore = cnt.rows[0].n as number;
    const firstTime = timesBefore === 0;

    if (!firstTime && !input.allowRepeat) {
      // Repeat needs explicit confirmation — do NOT register.
      return {
        status: 409,
        body: {
          registered: false,
          firstTime: false,
          repeat: true,
          timesEaten: timesBefore,
          card,
          message: isMeal
            ? "Already served; confirm to register a repetition"
            : "Already registered for this activity; confirm to register a repetition",
        },
      };
    }

    await client.query(
      `INSERT INTO activity_logs
         (user_id, activity_id, logged_by, logged_at, source_device_id, source_scan_id)
       VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6)
       ON CONFLICT (source_device_id, source_scan_id)
       WHERE source_device_id IS NOT NULL AND source_scan_id IS NOT NULL
       DO NOTHING`,
      [
        userId,
        activityId,
        actorId,
        input.scannedAt ?? null,
        input.sourceDeviceId ?? null,
        input.sourceScanId ?? null,
      ],
    );

    if (!firstTime) {
      // Every repetition is an explicit staff override and remains auditable.
      await audit(client, {
        actorId,
        entityType: isMeal ? "meal" : "activity",
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

  if (result.status === 200) {
    await broadcastForActiveUser(userId, SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_ACTIVITY_SCAN, {
      activityId,
      userId,
      firstTime: result.body.firstTime,
      repeat: result.body.repeat,
      scannedAt: (input.scannedAt ?? new Date()).toISOString(),
    });
  }

  return result;
}
