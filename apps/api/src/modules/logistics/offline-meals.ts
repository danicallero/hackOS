import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Job } from "bullmq";
import { pool, withTransaction } from "../../db/pool.js";
import { AppError, BadRequestError, NotFoundError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { broadcast } from "../../lib/sse.js";
import { activityScan } from "./activities.js";

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
  if (activity.rows[0].category !== "meal") {
    throw new BadRequestError("Offline meal queue only accepts meal activities", { activityId });
  }

  const batch = await withTransaction(async (client) => {
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
      const result = await activityScan(Number(batch.rows[0].submitted_by), row.activity_id, {
        badgeId: row.badge_id,
        allowRepeat: row.allow_repeat,
        scannedAt: row.scanned_at ?? undefined,
        sourceDeviceId: row.device_id,
        sourceScanId: row.client_scan_id,
      });
      await pool.query(
        `UPDATE meal_scan_batch_items
            SET status = 'processed', result = $2::jsonb, processed_at = now()
          WHERE id = $1`,
        [row.id, JSON.stringify(result.body)],
      );
      processed += 1;
    } catch (err) {
      const error =
        err instanceof AppError
          ? { code: err.code, message: err.message, details: err.details ?? null }
          : { code: "internal", message: "Meal scan processing failed" };
      await pool.query(
        `UPDATE meal_scan_batch_items
            SET status = 'failed', error = $2::jsonb, processed_at = now()
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
