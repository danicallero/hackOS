import { config } from "../config.js";
import { valkey } from "./valkey.js";

/**
 * Read-through cache shared by every API instance (Valkey) with single-flight:
 * when many clients ask for the same missing entry at once, one computes it
 * and the rest read the stored result (or await the same in-process promise).
 *
 * Invalidation bumps a per-namespace version, so every key of that namespace
 * becomes unreachable at once and expires on its own TTL. Valkey being down
 * only costs the cache: callers compute directly.
 */
const LOCK_MS = 10_000;
const WAIT_MS = 3_000;
const POLL_MS = 100;
const inFlight = new Map<string, Promise<unknown>>();

const versionKey = (namespace: string) => `cache:${config.SSE_NAMESPACE}:${namespace}:version`;

export async function invalidateSharedCache(namespace: string): Promise<void> {
  try {
    await valkey.incr(versionKey(namespace));
  } catch (err) {
    console.error(`[cache] invalidate(${namespace}) failed`, err);
  }
}

async function readEntry<T>(key: string): Promise<{ value: T } | null> {
  const raw = await valkey.get(key);
  return raw === null ? null : { value: JSON.parse(raw) as T };
}

export async function sharedCache<T>(
  namespace: string,
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  let fullKey: string;
  try {
    const version = (await valkey.get(versionKey(namespace))) ?? "0";
    fullKey = `cache:${config.SSE_NAMESPACE}:${namespace}:${version}:${key}`;
    const hit = await readEntry<T>(fullKey);
    if (hit) return hit.value;
  } catch {
    return compute();
  }
  const pending = inFlight.get(fullKey);
  if (pending) return pending as Promise<T>;
  const run = (async () => {
    const lockKey = `${fullKey}:lock`;
    let owner = false;
    try {
      owner = (await valkey.set(lockKey, "1", "PX", LOCK_MS, "NX")) === "OK";
      if (!owner) {
        // Another instance is computing it; read its result instead of the database.
        for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          const hit = await readEntry<T>(fullKey);
          if (hit) return hit.value;
        }
      }
    } catch {
      // Fall through to computing it ourselves.
    }
    try {
      const value = await compute();
      try {
        await valkey.set(fullKey, JSON.stringify(value), "EX", ttlSeconds);
      } catch {
        // A failed write only loses the cache entry.
      }
      return value;
    } finally {
      if (owner) await valkey.del(lockKey).catch(() => undefined);
    }
  })().finally(() => inFlight.delete(fullKey));
  inFlight.set(fullKey, run);
  return run;
}
