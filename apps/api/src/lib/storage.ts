import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

/**
 * Object storage (H44 sponsor logos). MinIO in dev/prod is S3-compatible;
 * `forcePathStyle` keeps URLs as endpoint/bucket/key rather than the
 * virtual-host form MinIO doesn't do by default. Uploads use presigned PUT
 * URLs so bytes never transit the API — the client PUTs straight to storage,
 * then persists the returned public URL.
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

const PRESIGN_TTL_S = 300;

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

/** Public URL an object is served from once uploaded. */
export function publicUrl(key: string): string {
  const base = config.S3_PUBLIC_URL ?? `${config.S3_ENDPOINT}/${config.S3_BUCKET}`;
  return `${base.replace(/\/$/, "")}/${key}`;
}

export interface PresignedUpload {
  uploadUrl: string; // presigned PUT — client uploads the bytes here
  key: string; // object key stored under the bucket
  publicUrl: string; // where the object will be reachable afterwards
  expiresInSeconds: number;
}

/**
 * Presign a PUT for an object key. Pure signing — no network round-trip — so
 * it works (and is testable) without the bucket being reachable.
 */
export async function presignUpload(key: string, contentType: string): Promise<PresignedUpload> {
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: PRESIGN_TTL_S },
  );
  return { uploadUrl, key, publicUrl: publicUrl(key), expiresInSeconds: PRESIGN_TTL_S };
}
