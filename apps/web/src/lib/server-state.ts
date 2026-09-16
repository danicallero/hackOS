/**
 * Small browser read-model policy for authenticated API resources. It is not
 * a second session model: SessionProvider supplies the identity boundary.
 * Entries are deliberately short-lived: callers invalidate exact resource
 * keys after mutations or domain SSE signals, then re-read Postgres state.
 */
export type ServerStateKey = readonly unknown[];

type Entry = {
  data?: unknown;
  request?: Promise<unknown>;
  controller?: AbortController;
};

let identity: string | number | null = null;
let epoch = 0;
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
}

/** Abort and forget an exact resource, so its next read is authoritative. */
export function invalidateServerState(key: ServerStateKey): void {
  const entry = entries.get(scopedKey(key));
  entry?.controller?.abort();
  entries.delete(scopedKey(key));
}

/**
 * One in-flight GET per active identity/resource. A response can populate the
 * cache only if the identity epoch and entry still match the request that made
 * it, preventing an old login or invalidated request from winning a race.
 */
export function readServerState<T>(
  key: ServerStateKey,
  fetcher: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const keyAtStart = scopedKey(key);
  const existing = entries.get(keyAtStart);
  if (existing?.data !== undefined) return Promise.resolve(existing.data as T);
  if (existing?.request) return existing.request as Promise<T>;

  const controller = new AbortController();
  const entry: Entry = { controller };
  const requestEpoch = epoch;
  const request = fetcher(controller.signal)
    .then((data) => {
      if (epoch === requestEpoch && entries.get(keyAtStart) === entry) entry.data = data;
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

/** Test-only cleanup for deterministic identity/cache tests. */
export function resetServerStateForTests(): void {
  for (const entry of entries.values()) entry.controller?.abort();
  entries.clear();
  identity = null;
  epoch = 0;
}
