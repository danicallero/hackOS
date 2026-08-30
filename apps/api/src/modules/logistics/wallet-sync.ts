import { pool } from "../../db/pool.js";
import { ServiceUnavailableError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { ApplePushUnregisteredError, sendApplePush } from "./apple-push.js";
import { expireGoogleObject } from "./google-wallet.js";
import { PASS_TYPE_IDENTIFIER } from "./wallet.js";

/**
 * Notifies devices after a `wallet_passes` row is voided (H28: badge
 * rotation must push the update, not just wait for the next pull). Queued
 * rather than called inline — both APNs and the Google Wallet API are
 * external calls that shouldn't hold up the rotation request or its
 * transaction (plan/07 §2: heavy/external work belongs in a worker).
 * Follows the same ad hoc job-per-event pattern as `offline-meals.ts`
 * (`logistics.meal-scans`), not a repeat-poll like the notification outbox.
 */

const QUEUE_NAME = "logistics.wallet-sync";

interface SyncJobData {
  passIds: number[];
}

export async function enqueueWalletSync(passIds: number[]): Promise<void> {
  if (passIds.length === 0) return;
  await getQueue(QUEUE_NAME).add(`sync:${passIds.join(",")}`, { passIds } satisfies SyncJobData);
}

interface PassRow {
  id: number;
  platform: "apple" | "google";
  google_object_id: string | null;
}

interface DeviceRow {
  pass_id: number;
  device_library_identifier: string;
  push_token: string;
}

export async function processWalletSync(job: { data: SyncJobData }): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, platform, google_object_id FROM wallet_passes WHERE id = ANY($1)`,
    [job.data.passIds],
  );

  // One query for every apple pass's devices instead of one per pass (N+1).
  const applePassIds = (rows as PassRow[])
    .filter((pass) => pass.platform === "apple")
    .map((pass) => pass.id);
  const devicesByPassId = new Map<number, DeviceRow[]>();
  if (applePassIds.length > 0) {
    const { rows: deviceRows } = await pool.query(
      `SELECT pass_id, device_library_identifier, push_token FROM wallet_pass_devices WHERE pass_id = ANY($1)`,
      [applePassIds],
    );
    for (const device of deviceRows as DeviceRow[]) {
      const list = devicesByPassId.get(device.pass_id);
      if (list) list.push(device);
      else devicesByPassId.set(device.pass_id, [device]);
    }
  }

  for (const pass of rows as PassRow[]) {
    if (pass.platform === "apple") {
      const devices = devicesByPassId.get(pass.id) ?? [];
      for (const device of devices) {
        try {
          await sendApplePush(device.push_token, PASS_TYPE_IDENTIFIER);
        } catch (err) {
          if (err instanceof ApplePushUnregisteredError) {
            await pool.query(
              `DELETE FROM wallet_pass_devices WHERE pass_id = $1 AND device_library_identifier = $2`,
              [pass.id, device.device_library_identifier],
            );
            continue;
          }
          throw err;
        }
      }
    } else if (pass.platform === "google" && pass.google_object_id) {
      try {
        await expireGoogleObject(pass.google_object_id);
      } catch (err) {
        // Google was configured when the pass was issued but no longer is —
        // retrying won't help until redeploy, so log and move on instead of
        // spinning BullMQ's retry budget on every future rotation.
        if (err instanceof ServiceUnavailableError) {
          console.warn("wallet: skipping Google sync,", err.message);
          continue;
        }
        throw err;
      }
    }
  }
}

registerWorker(QUEUE_NAME, processWalletSync);
