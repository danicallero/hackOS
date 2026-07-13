import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { valkey } from "./valkey.js";

const VERSION_KEY = "read-cache:version";
const TTL_SECONDS = 30;
const MAX_PAYLOAD_BYTES = 512 * 1024;

declare module "fastify" {
  interface FastifyRequest {
    readCacheKey?: string;
  }
}

function isCacheable(req: FastifyRequest): boolean {
  if (req.method !== "GET" || !req.url.startsWith("/api/")) return false;
  // Streams, auth responses and binary/download endpoints must never be
  // buffered as JSON read models.
  return !/(?:\/stream(?:[/?]|$)|^\/api\/auth\/|\/download(?:[/?]|$)|\/uploads(?:[/?]|$)|\/pace(?:[/?]|$))/.test(
    req.url,
  );
}

export async function readCacheKey(req: FastifyRequest): Promise<string | null> {
  if (!isCacheable(req)) return null;
  const version = (await valkey.get(VERSION_KEY)) ?? "0";
  const subject = req.userId == null ? "public" : `user:${req.userId}`;
  const digest = createHash("sha256").update(`${version}:${subject}:${req.url}`).digest("hex");
  return `read-cache:${version}:${digest}`;
}

export async function readCachedJson(key: string): Promise<unknown | null> {
  const value = await valkey.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function cacheJson(key: string | undefined, payload: unknown): Promise<void> {
  if (!key || typeof payload === "string" || Buffer.isBuffer(payload)) return;
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return;
  }
  if (Buffer.byteLength(serialized) > MAX_PAYLOAD_BYTES) return;
  await valkey.set(key, serialized, "EX", TTL_SECONDS);
}

/** Versioned keys make invalidation O(1); stale entries simply expire. */
export async function invalidateReadCache(): Promise<void> {
  await valkey.incr(VERSION_KEY);
}
