import type pg from "pg";

import type { Queryable } from "../../db/pool.js";

import { ServiceUnavailableError } from "../../lib/errors.js";

import { profilePrefix } from "../../lib/profile-files.js";

import { deleteObject, deletePrefix, deleteSubjectUploadObjects } from "../../lib/storage.js";

import { ApplePushUnregisteredError, sendApplePush } from "../logistics/apple-push.js";

import { expireGoogleObject } from "../logistics/google-wallet.js";

import type { GoogleObjectType } from "../logistics/wallet-passes.js";

import { PASS_TYPE_IDENTIFIER } from "../logistics/wallet-passes.js";

import type { RemovalPreparation, WalletArtifacts } from "./types.js";

export async function collectStorageKeys(client: pg.PoolClient, userId: number): Promise<string[]> {
  const { rows } = await client.query<{ storage_key: string }>(
    `SELECT storage_key
       FROM data_subject_requests
      WHERE subject_user_id = $1 AND storage_key IS NOT NULL
 UNION SELECT object_key FROM project_files WHERE uploaded_by=$1
 UNION SELECT thumbnail_key FROM project_files WHERE uploaded_by=$1 AND thumbnail_key IS NOT NULL`,
    [userId],
  );
  return [...new Set(rows.map((row) => row.storage_key).filter(Boolean))];
}

export async function collectUploadPrefixes(
  client: pg.PoolClient,
  userId: number,
): Promise<string[]> {
  const { rows } = await client.query<{ application_id: number }>(
    `SELECT DISTINCT application_id FROM application_responses WHERE user_id = $1`,
    [userId],
  );
  return rows.map((row) => `uploads/${row.application_id}/${userId}/`);
}

export async function collectExportPrefixes(
  client: pg.PoolClient,
  userId: number,
): Promise<string[]> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id
       FROM data_subject_requests
      WHERE subject_user_id = $1 AND type = 'export'`,
    [userId],
  );
  // Export workers upload under this request-owned prefix. Keeping the
  // prefix separate from storage_key closes the race where the bytes have
  // been uploaded but markCompleted has not yet persisted the key.
  return rows.map((row) => `exports/${row.id}/`);
}

function emptyWalletArtifacts(): WalletArtifacts {
  return { walletPassIds: [], googleWalletObjectIds: [], appleWalletPushTokens: [] };
}

export async function collectWalletArtifacts(
  client: Queryable,
  userId: number,
): Promise<WalletArtifacts> {
  const { rows } = await client.query<{
    id: number;
    google_object_id: string | null;
    google_object_type: GoogleObjectType | null;
    push_token: string | null;
  }>(
    `SELECT wp.id, wp.google_object_id, wp.google_object_type, wpd.push_token
       FROM wallet_passes wp
       LEFT JOIN wallet_pass_devices wpd ON wpd.pass_id = wp.id
      WHERE wp.user_id = $1`,
    [userId],
  );
  return {
    walletPassIds: [...new Set(rows.map((row) => row.id))],
    googleWalletObjectIds: [
      ...new Map(
        rows
          .filter((row) => Boolean(row.google_object_id))
          .map((row) => {
            const objectId = row.google_object_id as string;
            const objectType = row.google_object_type ?? "generic";
            return [`${objectType}:${objectId}`, { objectId, objectType }];
          }),
      ).values(),
    ],
    appleWalletPushTokens: [
      ...new Set(
        rows.map((row) => row.push_token).filter((value): value is string => Boolean(value)),
      ),
    ],
  };
}

export async function collectWalletArtifactsByPassIds(
  client: Queryable,
  passIds: number[],
): Promise<WalletArtifacts> {
  if (passIds.length === 0) return emptyWalletArtifacts();
  const { rows } = await client.query<{
    id: number;
    google_object_id: string | null;
    google_object_type: GoogleObjectType | null;
    push_token: string | null;
  }>(
    `SELECT wp.id, wp.google_object_id, wp.google_object_type, wpd.push_token
       FROM wallet_passes wp
       LEFT JOIN wallet_pass_devices wpd ON wpd.pass_id = wp.id
      WHERE wp.id = ANY($1::int[])`,
    [passIds],
  );
  return {
    walletPassIds: [...new Set(rows.map((row) => row.id))],
    googleWalletObjectIds: [
      ...new Map(
        rows
          .filter((row) => Boolean(row.google_object_id))
          .map((row) => {
            const objectId = row.google_object_id as string;
            const objectType = row.google_object_type ?? "generic";
            return [`${objectType}:${objectId}`, { objectId, objectType }];
          }),
      ).values(),
    ],
    appleWalletPushTokens: [
      ...new Set(
        rows.map((row) => row.push_token).filter((value): value is string => Boolean(value)),
      ),
    ],
  };
}

export async function invalidateWalletProviders(
  preparation: Pick<RemovalPreparation, "googleWalletObjectIds" | "appleWalletPushTokens">,
): Promise<void> {
  try {
    for (const object of preparation.googleWalletObjectIds) {
      await expireGoogleObject(object.objectId, object.objectType);
    }
    for (const pushToken of preparation.appleWalletPushTokens) {
      try {
        await sendApplePush(pushToken, PASS_TYPE_IDENTIFIER);
      } catch (error) {
        if (error instanceof ApplePushUnregisteredError) continue;
        throw error;
      }
    }
  } catch (error) {
    console.error("[removal] wallet provider cleanup failed", error);
    throw new ServiceUnavailableError(
      "Account wallet cleanup is waiting for an external provider. Your access has already been revoked; retry the operation later.",
      { code: "removal_provider_pending" },
    );
  }
}

export async function deleteStorageArtifacts(
  preparation: Pick<
    RemovalPreparation,
    "targetId" | "uploadPrefixes" | "exportPrefixes" | "storageKeys"
  >,
): Promise<void> {
  try {
    await deleteSubjectUploadObjects(preparation.targetId);
    // #934/#935: account photo and directory CV, including any object a
    // replaced upload left behind. The users/profile rows holding their keys
    // are deleted or scrubbed by the same removal.
    await deletePrefix(profilePrefix(preparation.targetId));
    for (const prefix of preparation.uploadPrefixes) await deletePrefix(prefix);
    for (const prefix of preparation.exportPrefixes) await deletePrefix(prefix);
    for (const key of preparation.storageKeys) await deleteObject(key);
  } catch (error) {
    console.error(`[removal] storage cleanup failed for user ${preparation.targetId}`, error);
    throw new ServiceUnavailableError(
      "Account cleanup is waiting for private storage. Your access has already been revoked; retry the operation later.",
      { code: "removal_storage_pending" },
    );
  }
}

export async function deleteExternalArtifacts(preparation: RemovalPreparation): Promise<void> {
  await invalidateWalletProviders(preparation);
  await deleteStorageArtifacts(preparation);
}
