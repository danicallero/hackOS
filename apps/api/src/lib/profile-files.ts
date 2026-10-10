import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyReply, FastifyRequest } from "fastify";
import { BadRequestError, NotFoundError } from "./errors.js";
import { deleteObject, getObject } from "./storage.js";

/**
 * Private profile objects (#934, #935): the account photo and the directory
 * CV live under `profiles/<user id>/`, which the bucket never exposes
 * anonymously (only `enterprises/` is public). Reads are proxied by the API
 * after an access check on every request; H54 removal deletes the whole
 * per-user prefix.
 */
export function profilePrefix(userId: number): string {
  return `profiles/${userId}/`;
}

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const CV_MAX_BYTES = 5 * 1024 * 1024;

const PHOTO_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
} as const;
type PhotoExtension = keyof typeof PHOTO_TYPES;

/** Identify the image from its bytes; the client's declared type is ignored. */
export function sniffPhoto(bytes: Buffer): { ext: PhotoExtension; contentType: string } | null {
  const startsWith = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte);
  let ext: PhotoExtension | null = null;
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ext = "png";
  else if (startsWith([0xff, 0xd8, 0xff])) ext = "jpg";
  else if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    ext = "webp";
  }
  return ext ? { ext, contentType: PHOTO_TYPES[ext] } : null;
}

/** The stored type of a photo object, from the extension its upload sniffed. */
export function photoContentType(key: string): string {
  const ext = key.split(".").pop() ?? "";
  return ext in PHOTO_TYPES ? PHOTO_TYPES[ext as PhotoExtension] : "application/octet-stream";
}

export function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * Stable object-name segment for one upload. A retry with the same
 * Idempotency-Key addresses the same object, so a response lost after the
 * object store accepted the bytes cannot leave a second copy behind.
 */
export function uploadOperation(req: FastifyRequest): string {
  return createHash("sha256")
    .update(req.idempotency?.key ?? `${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Read one multipart file up to `maxBytes`. Oversize uploads are refused as
 * an explicit business error rather than the plugin's generic 413.
 */
export async function readUpload(
  req: FastifyRequest,
  maxBytes: number,
): Promise<{ file: MultipartFile; bytes: Buffer }> {
  const file = await req.file({
    limits: { fileSize: maxBytes, files: 1 },
    throwFileSizeLimit: false,
  });
  if (!file) throw new BadRequestError("No file uploaded");
  const bytes = await file.toBuffer();
  if (file.file.truncated || bytes.length > maxBytes) {
    throw new BadRequestError(`File exceeds maximum size of ${maxBytes / (1024 * 1024)} MB`, {
      maxBytes,
    });
  }
  if (bytes.length === 0) throw new BadRequestError("The file is empty");
  return { file, bytes };
}

/**
 * Delete an object that a committed write just replaced. It is unreachable
 * already (no row references it); a failure is logged and the H54 removal
 * sweep of the owner's prefix still deletes it.
 */
export async function deleteReplacedObject(req: FastifyRequest, key: string | null): Promise<void> {
  if (!key) return;
  try {
    await deleteObject(key);
  } catch (err) {
    req.log.warn({ err }, "Could not delete a replaced profile object");
  }
}

/** The authenticated photo route, versioned by object so caches follow replacements. */
export function photoUrl(userId: number, photoKey: string | null): string | null {
  if (!photoKey) return null;
  const version = photoKey.split("/").pop()?.slice(0, 12) ?? "";
  return `/api/users/${userId}/photo?v=${version}`;
}

/** Keep the original name readable but path- and header-safe. */
export function safePdfFilename(name: string | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/\.pdf$/i, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/^[-. ]+/, "")
    .trim()
    .slice(0, 100);
  return `${cleaned || "cv"}.pdf`;
}

/**
 * Stream a private profile object. Only the reader's own browser may cache it
 * (`private`); `nosniff` keeps the stored type authoritative.
 */
export async function sendProfileObject(
  reply: FastifyReply,
  key: string,
  options: { contentType: string; cacheControl: string; filename?: string },
): Promise<FastifyReply> {
  let object: Awaited<ReturnType<typeof getObject>>;
  try {
    object = await getObject(key);
  } catch {
    throw new NotFoundError("File not found");
  }
  if (!object.Body) throw new NotFoundError("File not found");
  reply.header("content-type", options.contentType);
  if (object.ContentLength != null) reply.header("content-length", String(object.ContentLength));
  reply.header("cache-control", options.cacheControl);
  reply.header("x-content-type-options", "nosniff");
  if (options.filename) {
    const ascii = options.filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
    reply.header(
      "content-disposition",
      `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(options.filename)}`,
    );
  }
  return reply.send(object.Body as Readable);
}
