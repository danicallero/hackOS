import { randomUUID } from "node:crypto";
import type { WalletAlert } from "@hackos/shared/wallet-settings";
import { config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, TooManyRequestsError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { ApplePushUnregisteredError, sendApplePush } from "./apple-push.js";
import {
  refreshGoogleEventTicketClass,
  refreshGooglePassObject,
  sendGoogleWalletAlert,
} from "./google-wallet.js";
import { isSyntheticOperator } from "./review-fixture-scope.js";
import { PASS_TYPE_IDENTIFIER } from "./wallet.js";
import type { GoogleObjectType, PassRow } from "./wallet-passes.js";
import { ensureWalletSettings } from "./wallet-settings.js";

const QUEUE = "logistics.wallet-operations";
export async function createWalletOperation(
  actorId: number,
  requestKey: string,
  kind: "alert" | "refresh",
  translations?: WalletAlert,
) {
  return withTransaction(async (client) => {
    const synthetic = await isSyntheticOperator(client, actorId);
    await ensureWalletSettings(client);
    // H28/H53: serialize broadcasts and quotas; persist delivery work in the
    // same transaction as its audit. Providers are called outside this lock.
    await client.query(`SELECT id FROM wallet_settings WHERE id=1 FOR UPDATE`);
    const previous = await client.query(
      `SELECT *, (kind=$3 AND translations IS NOT DISTINCT FROM $4::jsonb) AS same FROM wallet_operations WHERE actor_id=$1 AND request_key=$2`,
      [actorId, requestKey, kind, translations ?? null],
    );
    if (previous.rows[0]) {
      const op = previous.rows[0];
      if (!op.same)
        throw new ConflictError("Idempotency key already used for a different Wallet operation");
      return operationSummary(op.id, client);
    }
    if (kind === "alert") {
      const count = await client.query(
        `SELECT count(*)::int AS count FROM wallet_operations WHERE kind='alert' AND is_test_account=$1 AND created_at > now()-interval '24 hours'`,
        [synthetic],
      );
      if (count.rows[0].count >= 3)
        throw new TooManyRequestsError("Wallet alerts are limited to three per 24 hours", 86400);
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO wallet_operations(id,actor_id,request_key,kind,translations,is_test_account) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, actorId, requestKey, kind, translations ?? null, synthetic],
    );
    await client.query(
      `INSERT INTO wallet_operation_passes(operation_id,pass_id)
      SELECT $1, p.id FROM wallet_passes p JOIN users u ON u.id=p.user_id
      WHERE p.status <> 'voided' AND u.account_state='active' AND u.anonymized_at IS NULL AND u.is_test_account=$2
        AND EXISTS (SELECT 1 FROM user_event_access a WHERE a.user_id=u.id)`,
      [id, synthetic],
    );
    // Only this operation's Apple recipients advance; the timestamp drives
    // Last-Modified as well as the collection cursor. Preserve monotonic tags.
    await client.query(
      `UPDATE wallet_passes p SET update_tag=GREATEST(
      (extract(epoch FROM clock_timestamp())*1000)::bigint, p.update_tag::numeric::bigint+1000,
      (SELECT COALESCE(MAX(update_tag::numeric)::bigint,0)+1 FROM wallet_passes WHERE platform='apple')
      )::text WHERE p.platform='apple' AND p.id IN (SELECT pass_id FROM wallet_operation_passes WHERE operation_id=$1)`,
      [id],
    );
    await audit(client, {
      actorId,
      entityType: "wallet_operation",
      entityId: id,
      action: kind === "alert" ? "alert_queued" : "refresh_queued",
      after: { kind, translations },
    });
    return operationSummary(id, client);
  });
}
export async function operationSummary(
  id: string,
  db = pool as import("../../db/pool.js").Queryable,
) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total,
    count(*) FILTER (WHERE status='queued')::int AS queued,
    count(*) FILTER (WHERE status='sent')::int AS sent,
    count(*) FILTER (WHERE status='failed')::int AS failed,
    count(*) FILTER (WHERE status='skipped')::int AS skipped
    FROM wallet_operation_passes WHERE operation_id=$1`,
    [id],
  );
  return { id, ...rows[0] };
}
interface Delivery extends PassRow {
  operation_id: string;
  kind: "alert" | "refresh";
  translations: WalletAlert | null;
  language: string;
  attempts: number;
}
export async function processWalletOperations(): Promise<number> {
  // Claims have a lease so a restarted worker can resume durable deliveries.
  const refreshedClasses = new Map<string, Promise<void>>();
  for (let processed = 0; processed < 25; processed++) {
    const { rows } = await pool.query(`WITH due AS (
    SELECT operation_id,pass_id FROM wallet_operation_passes
    WHERE status='queued' AND next_attempt_at<=now()
    ORDER BY next_attempt_at,operation_id,pass_id FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE wallet_operation_passes d SET attempts=d.attempts+1,next_attempt_at=now()+interval '90 seconds'
    FROM due WHERE d.operation_id=due.operation_id AND d.pass_id=due.pass_id RETURNING d.*
  ) SELECT p.*,c.operation_id,c.attempts,o.kind,o.translations,u.language
    FROM claimed c JOIN wallet_operations o ON o.id=c.operation_id JOIN wallet_passes p ON p.id=c.pass_id JOIN users u ON u.id=p.user_id`);
    if (!rows.length) return processed;
    for (const delivery of rows as Delivery[]) {
      try {
        // Account removal and entitlement are rechecked at delivery time.
        const eligible = await pool.query(
          `SELECT 1 FROM users u JOIN user_event_access a ON a.user_id=u.id
        WHERE u.id=$1 AND u.account_state='active' AND u.anonymized_at IS NULL`,
          [delivery.user_id],
        );
        if (!eligible.rowCount || delivery.status === "voided") {
          await pool.query(
            `UPDATE wallet_operation_passes SET status='skipped' WHERE operation_id=$1 AND pass_id=$2`,
            [delivery.operation_id, delivery.id],
          );
          continue;
        }
        if (delivery.platform === "apple") {
          const devices = await pool.query(
            `SELECT device_library_identifier,push_token FROM wallet_pass_devices WHERE pass_id=$1`,
            [delivery.id],
          );
          if (!devices.rowCount) {
            await pool.query(
              `UPDATE wallet_operation_passes SET status='skipped',last_error='No registered Apple Wallet device' WHERE operation_id=$1 AND pass_id=$2`,
              [delivery.operation_id, delivery.id],
            );
            continue;
          }
          const failures: unknown[] = [];
          for (const device of devices.rows) {
            try {
              await sendApplePush(device.push_token, PASS_TYPE_IDENTIFIER);
            } catch (err) {
              if (err instanceof ApplePushUnregisteredError)
                await pool.query(
                  `DELETE FROM wallet_pass_devices WHERE pass_id=$1 AND device_library_identifier=$2`,
                  [delivery.id, device.device_library_identifier],
                );
              else failures.push(err);
            }
          }
          if (failures.length) throw new AggregateError(failures, "Apple Wallet refresh failed");
        } else if (delivery.google_object_id) {
          if (delivery.kind === "alert") {
            const alert =
              delivery.translations?.[delivery.language as keyof WalletAlert] ??
              delivery.translations?.en;
            if (alert)
              await sendGoogleWalletAlert(
                delivery.google_object_id,
                delivery.google_object_type as GoogleObjectType,
                delivery.operation_id,
                alert,
              );
          } else {
            if (delivery.google_object_type === "event_ticket") {
              let refreshed = refreshedClasses.get(delivery.operation_id);
              if (!refreshed) {
                refreshed = refreshGoogleEventTicketClass();
                refreshedClasses.set(delivery.operation_id, refreshed);
              }
              await refreshed;
            }
            await refreshGooglePassObject(delivery);
          }
        }
        await pool.query(
          `UPDATE wallet_operation_passes SET status='sent',last_error=NULL WHERE operation_id=$1 AND pass_id=$2`,
          [delivery.operation_id, delivery.id],
        );
      } catch (err) {
        await pool.query(
          `UPDATE wallet_operation_passes SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END,
        next_attempt_at=now()+($3 * interval '1 second'),last_error=$4 WHERE operation_id=$1 AND pass_id=$2`,
          [
            delivery.operation_id,
            delivery.id,
            Math.min(300, 5 * 2 ** (delivery.attempts - 1)),
            err instanceof Error ? err.message : String(err),
          ],
        );
      }
    }
  }
  return 25;
}
registerWorker(QUEUE, processWalletOperations);
export async function scheduleWalletOperations(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE).add(
    QUEUE,
    {},
    { repeat: { every: 15_000 }, jobId: QUEUE, removeOnComplete: true, removeOnFail: true },
  );
}
