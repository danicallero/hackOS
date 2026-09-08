import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { ApiError, getClockSkewMs } from "./api";
import { useMeContext } from "./me-context";
import {
  deleteScan,
  getScannerMeta,
  pendingScans,
  retryFailedScans,
  retryScan,
  syncErrorHistory,
} from "./scanner-db";
import { synchronizeScanner } from "./scanner-sync";
import type { PendingScan, ScannerSnapshot, ScannerSyncErrorEntry } from "./scanner-types";

/** Sync stopped retrying automatically after this many straight failures. */
const MAX_AUTO_RETRIES = 3;
/**
 * Status codes that are NOT a verdict on the request itself (expired
 * session, request already in flight, rate limiting) — see the matching
 * list in scanner-sync.ts's replayPendingScans. Everything else in the 4xx
 * range is the server rejecting the sync outright (e.g. a conflict), and
 * retrying it unchanged on the next 15s tick would just reproduce it.
 */
const TRANSIENT_STATUSES = [401, 403, 408, 429];

export interface ScannerSyncError {
  message: string;
  /** A genuine server rejection (e.g. conflict) rather than a transient blip. */
  conflict: boolean;
}

interface ScannerSyncSnapshot {
  syncing: boolean;
  lastSync: string | null;
  queue: PendingScan[];
  errorHistory: ScannerSyncErrorEntry[];
  error: ScannerSyncError | null;
  autoRetryPaused: boolean;
  serverSnapshot: ScannerSnapshot | null;
  localError: Error | null;
  clockSkewMs: number | null;
}

function asLocalError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Local scanner storage failed");
}

function initialSnapshot(): ScannerSyncSnapshot {
  return {
    syncing: false,
    lastSync: null,
    queue: [],
    errorHistory: [],
    error: null,
    autoRetryPaused: false,
    serverSnapshot: null,
    localError: null,
    clockSkewMs: null,
  };
}

/**
 * One `ScannerSyncStore` per signed-in staff member backs every mounted
 * screen that calls `useScannerSync()` — general/activity scanners, the
 * people directory, activities, presence management, and the sync-queue
 * screen can all be alive at once in the tab/stack navigator. Before this
 * store existed, each of those was an independent `useState` + its own 15s
 * `setInterval` + its own `AppState` listener, so N mounted screens meant N
 * concurrent `/api/scanner/snapshot` fetches and N full SQLite
 * replace-all writes every 15s instead of one. `synchronizeScanner()`
 * already dedupes *concurrent* calls for the same owner, but not
 * *successive* ones — each independent timer still kicked off its own run
 * as soon as the previous one settled.
 *
 * The store is looked up (and lazily created) by `ownerUserId`; the offline
 * queue and cached directory are already partitioned per user in SQLite
 * (scanner-db.ts), so it's keyed the same way here.
 */
class ScannerSyncStore {
  private readonly ownerUserId: number;
  private state: ScannerSyncSnapshot = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private refCount = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: { remove(): void } | null = null;
  private consecutiveFailures = 0;
  // Read by the interval/AppState listener only — a manual retry (calling
  // `sync()` directly, e.g. from a "retry" button) always goes through
  // regardless of this flag.
  private autoRetryPaused = false;

  constructor(ownerUserId: number) {
    this.ownerUserId = ownerUserId;
  }

  private setState(patch: Partial<ScannerSyncSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  getSnapshot = (): ScannerSyncSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  refreshLocal = async (): Promise<void> => {
    const [meta, scans, errors] = await Promise.all([
      getScannerMeta(this.ownerUserId),
      pendingScans(this.ownerUserId),
      syncErrorHistory(this.ownerUserId),
    ]);
    this.setState({ lastSync: meta.lastSync, queue: scans, errorHistory: errors });
  };

  sync = async (): Promise<void> => {
    this.setState({ syncing: true });
    try {
      const result = await synchronizeScanner(this.ownerUserId);
      this.consecutiveFailures = 0;
      this.autoRetryPaused = false;
      this.setState({
        serverSnapshot: result.snapshot,
        localError: result.localError,
        error: null,
        autoRetryPaused: false,
      });
    } catch (cause) {
      const conflict =
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        !TRANSIENT_STATUSES.includes(cause.status);
      this.consecutiveFailures += 1;
      if (conflict || this.consecutiveFailures >= MAX_AUTO_RETRIES) {
        this.autoRetryPaused = true;
        this.setState({ autoRetryPaused: true });
      }
      this.setState({
        error: { message: cause instanceof Error ? cause.message : "Sync failed", conflict },
      });
    } finally {
      // Keep local queue metadata best-effort too. A locked/corrupt backup
      // must not keep a successful server sync in the loading state.
      void this.refreshLocal().catch((cause) => {
        if (this.state.localError === null) this.setState({ localError: asLocalError(cause) });
      });
      this.setState({ clockSkewMs: getClockSkewMs(), syncing: false });
    }
  };

  retryFailed = async (): Promise<void> => {
    await retryFailedScans(this.ownerUserId);
    await this.sync();
  };

  /** Retries just the one scan the operator picked, rather than every failed entry in the queue. */
  retryOne = async (id: string): Promise<void> => {
    await retryScan(id, this.ownerUserId);
    await this.sync();
  };

  /**
   * Manual, one-at-a-time discard for a scan the operator has given up
   * retrying (typically after logging it by hand in the web admin panel).
   * Never invoked automatically — there is no attempt-count threshold that
   * deletes a scan on its own, since a queued scan is the only record of
   * that transaction until it's acknowledged by the server.
   */
  discardScan = async (id: string): Promise<void> => {
    await deleteScan(id, this.ownerUserId);
    await this.refreshLocal();
  };

  /** Called once by each mounted `useScannerSync()` consumer; returns its release function. */
  acquire(): () => void {
    this.refCount += 1;
    if (this.refCount === 1) this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release() {
    this.refCount -= 1;
    if (this.refCount <= 0) {
      this.stop();
      // Drop the store once nothing observes this operator anymore (e.g.
      // sign-out, or navigating away from every scanner-related screen) so a
      // shared device cycling through many staff members over an event
      // doesn't accumulate one store per user for its whole lifetime.
      if (stores.get(this.ownerUserId) === this) stores.delete(this.ownerUserId);
    }
  }

  private start() {
    // Do not let a broken local backup prevent the first online snapshot.
    // `sync` fetches the server directory and publishes it independently.
    void this.refreshLocal().catch((cause) => {
      this.setState({ localError: asLocalError(cause) });
    });
    void this.sync().catch(() => undefined);
    this.intervalHandle = setInterval(() => {
      // Pausing auto-retry only skips the network attempt — local state
      // (the queue, including scans enqueued from another screen sharing
      // this same store) still needs to keep refreshing, or a paused screen
      // goes stale and stops showing newly queued scans at all until a
      // manual retry.
      if (this.autoRetryPaused) void this.refreshLocal();
      else void this.sync();
    }, 15_000);
    this.appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      if (this.autoRetryPaused) void this.refreshLocal();
      else void this.sync();
    });
  }

  private stop() {
    if (this.intervalHandle !== null) clearInterval(this.intervalHandle);
    this.appStateSubscription?.remove();
    this.intervalHandle = null;
    this.appStateSubscription = null;
  }
}

const stores = new Map<number, ScannerSyncStore>();

function getStore(ownerUserId: number): ScannerSyncStore {
  let store = stores.get(ownerUserId);
  if (!store) {
    store = new ScannerSyncStore(ownerUserId);
    stores.set(ownerUserId, store);
  }
  return store;
}

const EMPTY_SNAPSHOT = initialSnapshot();
const noSubscribe = () => () => {};
const getEmptySnapshot = () => EMPTY_SNAPSHOT;

/**
 * Every read/replay here is scoped to the currently signed-in staff member
 * (`me.id`) — the offline scan queue is encrypted and partitioned per user
 * (scanner-db.ts), so this hook only ever sees this operator's own pending
 * scans, never a predecessor's still-unsynced work on a shared device.
 *
 * Multiple screens mounted at once for the same operator share a single
 * `ScannerSyncStore` (one 15s timer, one `AppState` listener, one
 * `/api/scanner/snapshot` fetch per tick) instead of each running its own —
 * see the class doc above.
 */
export function useScannerSync() {
  const { me } = useMeContext();
  const ownerUserId = me?.id ?? null;
  const store = useMemo(() => (ownerUserId === null ? null : getStore(ownerUserId)), [ownerUserId]);

  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? getEmptySnapshot,
  );

  useEffect(() => {
    if (!store) return;
    return store.acquire();
  }, [store]);

  // Memoized so callers passing these fields down to memoized children (or
  // into effect/callback dependency arrays) don't see a new object — and
  // therefore new fallback no-op functions below — on every unrelated
  // re-render of the calling component.
  return useMemo(
    () => ({
      ...state,
      sync: store?.sync ?? (async () => {}),
      retryFailed: store?.retryFailed ?? (async () => {}),
      retryOne: store?.retryOne ?? (async (_id: string) => {}),
      discardScan: store?.discardScan ?? (async (_id: string) => {}),
      refreshLocal: store?.refreshLocal ?? (async () => {}),
    }),
    [state, store],
  );
}
