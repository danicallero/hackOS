import Storage from "expo-sqlite/kv-store";

export interface CachedValue<T> {
  data: T;
  updatedAt: string;
}

const PREFIX = "hackos:offline:v1:";
let storageEpoch = 0;
const pendingOperations = new Map<string, Promise<void>>();

function enqueueStorageOperation(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingOperations.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(operation)
    .catch(() => undefined);
  pendingOperations.set(key, next);
  void next.finally(() => {
    if (pendingOperations.get(key) === next) pendingOperations.delete(key);
  });
  return next;
}

export async function readCachedValue<T>(key: string): Promise<CachedValue<T> | null> {
  try {
    const raw = await Storage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedValue<T>>;
    if (!("data" in parsed) || typeof parsed.updatedAt !== "string") return null;
    return parsed as CachedValue<T>;
  } catch {
    return null;
  }
}

export async function writeCachedValue<T>(
  key: string,
  data: T,
  updatedAt = new Date().toISOString(),
): Promise<void> {
  const storageKey = `${PREFIX}${key}`;
  const epochAtStart = storageEpoch;
  await enqueueStorageOperation(storageKey, async () => {
    if (storageEpoch !== epochAtStart) return;
    try {
      await Storage.setItem(storageKey, JSON.stringify({ data, updatedAt }));
    } catch {
      // Cache persistence must never turn a successful API response into an error.
    }
  });
}

/** Remove one cache entry without touching offline scanner/wallet data. */
export async function clearCachedValue(key: string): Promise<void> {
  storageEpoch += 1;
  const storageKey = `${PREFIX}${key}`;
  await enqueueStorageOperation(storageKey, async () => {
    try {
      await Storage.removeItem(storageKey);
    } catch {
      // Cache cleanup must never block sign-out or session recovery.
    }
  });
}

export async function getOfflineCacheBytes(): Promise<number> {
  try {
    const keys = (await Storage.getAllKeysAsync()).filter((key) => key.startsWith(PREFIX));
    const entries = await Storage.multiGet(keys);
    return entries.reduce((total, [, value]) => total + (value?.length ?? 0), 0);
  } catch {
    return 0;
  }
}

export async function clearOfflineCache(): Promise<void> {
  storageEpoch += 1;
  try {
    const keys = new Set([
      ...(await Storage.getAllKeysAsync()).filter((key) => key.startsWith(PREFIX)),
      ...[...pendingOperations.keys()].filter((key) => key.startsWith(PREFIX)),
    ]);
    await Promise.all(
      [...keys].map((key) => enqueueStorageOperation(key, () => Storage.removeItem(key))),
    );
  } catch {
    // Best-effort: clearing the cache must never throw into the UI.
  }
}

/**
 * Remove every ordinary cache entry owned by one account. Scanner SQLite data
 * is deliberately outside this keyspace and remains partitioned by owner.
 * Bumping the epoch makes writes that began before logout no-ops, while
 * per-key queues ensure a late remove cannot race a newer write for the same
 * key.
 */
export async function clearCachedValues(prefix: string): Promise<void> {
  storageEpoch += 1;
  try {
    const storagePrefix = `${PREFIX}${prefix}`;
    const keys = new Set([
      ...(await Storage.getAllKeysAsync()).filter((key) => key.startsWith(storagePrefix)),
      ...[...pendingOperations.keys()].filter((key) => key.startsWith(storagePrefix)),
    ]);
    await Promise.all(
      [...keys].map((key) => enqueueStorageOperation(key, () => Storage.removeItem(key))),
    );
  } catch {
    // Best-effort: account cleanup must never block sign-out or recovery.
  }
}
