/**
 * Small browser read-model policy for authenticated API resources. It is not
 * a second session model: SessionProvider supplies the identity boundary.
 * Entries are deliberately short-lived: callers invalidate exact resource
 * keys after mutations or domain SSE signals, then re-read Postgres state.
 */
export type ServerStateKey = readonly unknown[];

/** Settled data is reusable for this long; a later mount re-reads the API. */
const DATA_TTL_MS = 30_000;

/**
 * Stale-while-revalidate window: settled data older than the TTL may still be
 * painted instantly on mount (`peekServerState`) while a fresh read runs.
 */
const STALE_PAINT_MS = 5 * 60_000;

type Entry = {
  data?: unknown;
  at?: number;
  request?: Promise<unknown>;
  controller?: AbortController;
};

let identity: string | number | null = null;
let epoch = 0;
const identityListeners = new Set<() => void>();
const writeListeners = new Set<(serializedKey: string, data: unknown) => void>();
const entries = new Map<string, Entry>();

function serialize(key: ServerStateKey): string {
  return JSON.stringify(key);
}

function scopedKey(key: ServerStateKey): string {
  return `${identity ?? "anonymous"}:${serialize(key)}`;
}

/** Called only by the existing session boundary when the authenticated user changes. */
export function setServerStateIdentity(nextIdentity: string | number | null): void {
  if (identity === nextIdentity) return;
  identity = nextIdentity;
  epoch += 1;
  for (const entry of entries.values()) entry.controller?.abort();
  entries.clear();
  for (const listener of identityListeners) listener();
}

/** Drop every cached read and make mounted readers refetch (edition switch, edition lifecycle changes). */
export function invalidateAllServerState(): void {
  epoch += 1;
  for (const entry of entries.values()) entry.controller?.abort();
  entries.clear();
  for (const listener of identityListeners) listener();
}

/** Identity epoch snapshot for `useSyncExternalStore`; changes with every identity switch. */
export function serverStateEpoch(): number {
  return epoch;
}

export function subscribeServerStateEpoch(listener: () => void): () => void {
  identityListeners.add(listener);
  return () => {
    identityListeners.delete(listener);
  };
}

/** Replace an exact resource with data a mutation already returned. */
export function writeServerState<T>(key: ServerStateKey, data: T): void {
  const k = scopedKey(key);
  entries.get(k)?.controller?.abort();
  entries.set(k, { data, at: Date.now() });
  for (const listener of writeListeners) listener(serialize(key), data);
}

/** Observe `writeServerState` so every reader of a key follows a mutation's result. */
export function subscribeServerStateWrites(
  listener: (serializedKey: string, data: unknown) => void,
): () => void {
  writeListeners.add(listener);
  return () => {
    writeListeners.delete(listener);
  };
}

/** Abort and forget an exact resource, so its next read is authoritative. */
export function invalidateServerState(key: ServerStateKey): void {
  const entry = entries.get(scopedKey(key));
  entry?.controller?.abort();
  entries.delete(scopedKey(key));
}

/**
 * Age every settled resource under a key prefix past the TTL, so its next read
 * goes to the API. For a change that reaches views that are not mounted (a list
 * left behind while its detail page mutates it): unlike `invalidateServerState`
 * the data stays paintable and in-flight reads are left alone.
 */
export function expireServerStatePrefix(prefix: ServerStateKey): void {
  const start = `${identity ?? "anonymous"}:${serialize(prefix).slice(0, -1)}`;
  const expired = Date.now() - DATA_TTL_MS;
  for (const [key, entry] of entries) {
    if (!key.startsWith(start)) continue;
    const next = key[start.length];
    if (next !== "," && next !== "]") continue;
    if (entry.at !== undefined && entry.at > expired) entry.at = expired;
  }
}

/**
 * Settled data for an exact resource, fresh or stale (up to five minutes), or
 * `undefined`. For painting a mount instantly; it never starts a request, so
 * callers still revalidate in the background (stale-while-revalidate).
 */
export function peekServerState<T>(key: ServerStateKey): T | undefined {
  const entry = entries.get(scopedKey(key));
  if (entry?.data === undefined || Date.now() - (entry.at ?? 0) >= STALE_PAINT_MS) return undefined;
  return entry.data as T;
}

/**
 * One in-flight GET per active identity/resource. A response can populate the
 * cache only if the identity epoch and entry still match the request that made
 * it, preventing an old login or invalidated request from winning a race.
 * Previous settled data stays peekable until the new response replaces it.
 */
function fetchInto<T>(
  key: ServerStateKey,
  fetcher: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const keyAtStart = scopedKey(key);
  const existing = entries.get(keyAtStart);
  if (existing?.request) return existing.request as Promise<T>;

  const controller = new AbortController();
  const entry: Entry = { controller, data: existing?.data, at: existing?.at };
  const requestEpoch = epoch;
  const request = fetcher(controller.signal)
    .then((data) => {
      if (epoch === requestEpoch && entries.get(keyAtStart) === entry) {
        entry.data = data;
        entry.at = Date.now();
      }
      return data;
    })
    .finally(() => {
      if (entries.get(keyAtStart) === entry) {
        entry.request = undefined;
        entry.controller = undefined;
      }
    });
  entry.request = request;
  entries.set(keyAtStart, entry);
  return request;
}

/** Reuse settled data younger than the TTL; otherwise read the API. */
export function readServerState<T>(
  key: ServerStateKey,
  fetcher: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const existing = entries.get(scopedKey(key));
  if (existing?.data !== undefined && Date.now() - (existing.at ?? 0) < DATA_TTL_MS) {
    return Promise.resolve(existing.data as T);
  }
  return fetchInto(key, fetcher);
}

/** Always read the API (joining an in-flight read); the result replaces the cache. */
export function revalidateServerState<T>(
  key: ServerStateKey,
  fetcher: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return fetchInto(key, fetcher);
}

/** Test-only cleanup for deterministic identity/cache tests. */
export function resetServerStateForTests(): void {
  for (const entry of entries.values()) entry.controller?.abort();
  entries.clear();
  identity = null;
  epoch = 0;
}
