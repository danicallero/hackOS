import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
