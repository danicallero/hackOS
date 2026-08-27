import { isMealActivityKind } from "@hackos/shared/activity-kinds";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Job } from "bullmq";
import { pool, withTransaction } from "../../db/pool.js";
import { AppError, BadRequestError, NotFoundError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { broadcast } from "../../lib/sse.js";
import { activityScan } from "./activities.js";
import { resolveByBadge } from "./badge.js";
import { assertFixtureSubjectScope } from "./review-fixture-scope.js";

const QUEUE_NAME = "logistics.meal-scans";

interface MealScanJob {
  batchId: number;
}

export async function enqueueMealScanBatch(
  actorId: number,
  activityId: number,
  input: {
    deviceId: string;
    scans: Array<{
      clientScanId: string;
      badgeId: string;
      allowRepeat: boolean;
      scannedAt?: Date;
    }>;
  },
) {
  const activity = await pool.query(`SELECT category FROM activities WHERE id = $1`, [activityId]);
  if (!activity.rows[0]) throw new NotFoundError("Activity not found");
  if (!isMealActivityKind(activity.rows[0].category)) {
    throw new BadRequestError("Offline meal queue only accepts meal activities", { activityId });
  }

  const batch = await withTransaction(async (client) => {
    // H54: validate and share-lock every badge before persisting the offline
    // inbox row. Removal takes the same user row lock, so a stale device
    // cannot create a new identifying batch item after closure begins.
    for (const badgeId of [...new Set(input.scans.map((scan) => scan.badgeId))].sort()) {
      const userId = await resolveByBadge(client, badgeId);
      const owner = await client.query(
        `SELECT id FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
          FOR SHARE`,
        [userId],
      );
      if (!owner.rows[0]) throw new NotFoundError("Badge not recognized");
      await assertFixtureSubjectScope(client, actorId, userId);
    }

    const b = await client.query(
      `INSERT INTO meal_scan_batches (activity_id, device_id, submitted_by)
       VALUES ($1, $2, $3)
       RETURNING id, status`,
      [activityId, input.deviceId, actorId],
    );
    const batchId = b.rows[0].id as number;

    let accepted = 0;
    let duplicate = 0;
    for (const scan of input.scans) {
      const r = await client.query(
        `INSERT INTO meal_scan_batch_items
           (batch_id, activity_id, device_id, client_scan_id, badge_id, allow_repeat, scanned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (device_id, client_scan_id) DO NOTHING
         RETURNING id`,
        [
          batchId,
          activityId,
          input.deviceId,
          scan.clientScanId,
          scan.badgeId,
          scan.allowRepeat,
          scan.scannedAt ?? null,
        ],
      );
      if (r.rowCount === 1) accepted += 1;
      else duplicate += 1;
    }

    return { batchId, accepted, duplicate };
  });

  await getQueue(QUEUE_NAME).add(`batch:${batch.batchId}`, { batchId: batch.batchId });
  return { ...batch, queued: true };
}

export async function processMealScanBatch(job: Job<MealScanJob>) {
  const batchId = job.data.batchId;
  const batch = await pool.query(
    `SELECT activity_id, submitted_by FROM meal_scan_batches WHERE id = $1`,
    [batchId],
  );
  if (!batch.rows[0]) throw new NotFoundError("Meal scan batch not found");

  const rows = await withTransaction(async (client) => {
    await client.query(`UPDATE meal_scan_batches SET status = 'processing' WHERE id = $1`, [
      batchId,
    ]);
    const claimed = await client.query(
      `SELECT id, activity_id, device_id, client_scan_id, badge_id, allow_repeat, scanned_at
         FROM meal_scan_batch_items
        WHERE batch_id = $1 AND status = 'pending'
        ORDER BY id ASC
        FOR UPDATE`,
      [batchId],
    );
    if (claimed.rows.length > 0) {
      await client.query(
        `UPDATE meal_scan_batch_items
            SET status = 'processing'
          WHERE id = ANY($1::int[])`,
        [claimed.rows.map((r: { id: number }) => r.id)],
      );
    }
    return claimed.rows;
  });

  let processed = 0;
  let failed = 0;
  for (const row of rows as Array<{
    id: number;
    activity_id: number;
    device_id: string;
    client_scan_id: string;
    badge_id: string;
    allow_repeat: boolean;
    scanned_at: Date | null;
  }>) {
    try {
      const result = await activityScan(
        batch.rows[0].submitted_by as number | null,
        row.activity_id,
        {
          badgeId: row.badge_id,
          allowRepeat: row.allow_repeat,
          scannedAt: row.scanned_at ?? undefined,
          sourceDeviceId: row.device_id,
          sourceScanId: row.client_scan_id,
        },
      );
      // The response card is useful to the live scanner but is not an audit
      // field. Storing it here would retain the participant's name and
      // dietary information in the offline inbox after processing.
      const storedResult = {
        registered: result.body.registered,
        firstTime: result.body.firstTime,
        repeat: result.body.repeat,
        timesEaten: result.body.timesEaten,
        ...(result.body.message ? { message: result.body.message } : {}),
      };
      await pool.query(
        `UPDATE meal_scan_batch_items
            SET status = 'processed', badge_id = NULL, result = $2::jsonb, processed_at = now()
          WHERE id = $1`,
        [row.id, JSON.stringify(storedResult)],
      );
      processed += 1;
    } catch (err) {
      // A stale offline badge must not remain in the central inbox after the
      // account was closed. There is no audit value in keeping an unprocessed
      // raw badge identifier once it can no longer resolve to a participant.
      if (
        err instanceof AppError &&
        ["badge_revoked", "badge_unknown", "not_found"].includes(err.code)
      ) {
        await pool.query(`DELETE FROM meal_scan_batch_items WHERE id = $1`, [row.id]);
        failed += 1;
        continue;
      }
      const error =
        err instanceof AppError
          ? { code: err.code, message: err.message, details: err.details ?? null }
          : { code: "internal", message: "Meal scan processing failed" };
      await pool.query(
        `UPDATE meal_scan_batch_items
            SET status = 'failed', badge_id = NULL, error = $2::jsonb, processed_at = now()
          WHERE id = $1`,
        [row.id, JSON.stringify(error)],
      );
      failed += 1;
    }
  }

  const status = failed === 0 ? "processed" : processed === 0 ? "failed" : "partial";
  await pool.query(`UPDATE meal_scan_batches SET status = $2 WHERE id = $1`, [batchId, status]);
  const payload = { batchId, status, processed, failed };
  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_MEAL_SCAN_BATCH, payload);
  return payload;
}

registerWorker(QUEUE_NAME, processMealScanBatch);
