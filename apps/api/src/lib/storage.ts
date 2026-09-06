import {
  DeleteObjectsCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

/**
 * Object storage (H44 sponsor logos). MinIO in dev/prod is S3-compatible;
 * `forcePathStyle` keeps URLs as endpoint/bucket/key rather than the
 * virtual-host form MinIO doesn't do by default. Uploads are multipart POSTs
 * proxied through the API, which then persists the resulting object key.
 */

const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
});

/**
 * Fetch a PRIVATE object's bytes server-side. Downloads of application uploads
 * are PROXIED through the API rather than presigned, so the owner-or-staff check
 * runs on every request against the caller's session — a copied link grants
 * nothing to anyone who isn't authorised (H12).
 */
export async function getObject(key: string): Promise<GetObjectCommandOutput> {
  return s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

/**
 * Cheap existence check (metadata only, no body) — used to pre-flight a batch
 * of keys before committing to a streamed response, where a failure can no
 * longer become a clean HTTP error once headers are sent (H56 bulk export).
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload bytes to storage server-side and return the public URL. Used when the
 * browser can't reach the object store directly (private MinIO behind the app
 * network / a tunnel) — the client POSTs the file to the API, the API stores
 * it here. `publicUrl` still governs where it's *served* from, so set
 * S3_PUBLIC_URL to a browser-reachable host for the object to display.
 */
export async function putObject(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return publicUrl(key);
}

/**
 * Delete private objects belonging to one data subject. The caller must pass
 * a complete, server-constructed prefix (never a request-provided path).
 * S3 has no portable recursive delete operation, so list pages are deleted in
 * batches of at most 1,000 objects. A failure is propagated deliberately: the
 * H54 lifecycle remains `removal_pending` until storage cleanup can be retried.
 */
export async function deletePrefix(prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (page.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);
    await deleteKeys(keys);
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function deleteKeys(keys: string[]): Promise<void> {
  for (let offset = 0; offset < keys.length; offset += 1_000) {
    const batch = keys.slice(offset, offset + 1_000);
    if (batch.length === 0) continue;
    const result = await s3.send(
      new DeleteObjectsCommand({
        Bucket: config.S3_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if ((result.Errors?.length ?? 0) > 0) {
      throw new Error(`Object storage rejected ${result.Errors?.length} object deletions`);
    }
  }
}

/**
 * Remove legacy/orphaned application uploads for one subject. Older clients
 * could upload before a response row existed, so response-derived prefixes
 * alone are not a complete deletion proof. The list is broad only at the
 * object-store read boundary; deletion is restricted to the exact user-id
 * path segment and never accepts a request-provided prefix.
 */
export async function deleteSubjectUploadObjects(userId: number): Promise<void> {
  const subjectPrefix = new RegExp(`^uploads/[^/]+/${userId}/`);
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.S3_BUCKET,
        Prefix: "uploads/",
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (page.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => typeof key === "string" && subjectPrefix.test(key));
    await deleteKeys(keys);
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

/** Delete one known private object. Missing objects are already idempotent in S3. */
export async function deleteObject(key: string): Promise<void> {
  await deleteKeys([key]);
}

/** Public URL an object is served from once uploaded. */
export function publicUrl(key: string): string {
  const base = config.S3_PUBLIC_URL ?? `${config.S3_ENDPOINT}/${config.S3_BUCKET}`;
  return `${base.replace(/\/$/, "")}/${key}`;
}
