import Storage from "expo-sqlite/kv-store";

export interface CachedValue<T> {
  data: T;
  updatedAt: string;
}

const PREFIX = "hackos:offline:v1:";

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
  try {
    await Storage.setItem(`${PREFIX}${key}`, JSON.stringify({ data, updatedAt }));
  } catch {
    // Cache persistence must never turn a successful API response into an error.
  }
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
  try {
    const keys = (await Storage.getAllKeysAsync()).filter((key) => key.startsWith(PREFIX));
    await Storage.multiRemove(keys);
  } catch {
    // Best-effort: clearing the cache must never throw into the UI.
  }
}
