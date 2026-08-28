// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOfflineQueue,
  isStaleOfflineScanError,
  loadOfflineQueue,
  type OfflineScan,
  saveOfflineQueue,
  updateOfflineQueue,
} from "./offline-queue";

const saved: OfflineScan = {
  clientScanId: "device-operation-1",
  activityId: 7,
  activityName: "Dinner",
  badgeId: "BADGE-7",
  allowRepeat: false,
  scannedAt: "2026-07-17T20:00:00.000Z",
  status: "pending",
  failureKind: "offline",
  error: "Network unavailable",
};

class FakeRequest<T = unknown> {
  result!: T;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeDatabase {
  readonly stores = new Map<string, Map<string, unknown>>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };

  createObjectStore(name: string) {
    const store = new Map<string, unknown>();
    this.stores.set(name, store);
    return new FakeObjectStore(store);
  }

  transaction(name: string) {
    return new FakeTransaction(this.stores.get(name) ?? new Map());
  }

  close() {}
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;
  constructor(private readonly store: Map<string, unknown>) {}
  objectStore() {
    return new FakeObjectStore(this.store, this);
  }
}

class FakeObjectStore {
  constructor(
    private readonly store: Map<string, unknown>,
    private readonly transaction?: FakeTransaction,
  ) {}

  get(key: string) {
    const request = new FakeRequest<unknown>();
    queueMicrotask(() => {
      request.result = this.store.get(key);
      request.onsuccess?.();
    });
    return request;
  }

  put(value: { slot: string }) {
    const request = new FakeRequest<unknown>();
    queueMicrotask(() => {
      this.store.set(value.slot, value);
      request.onsuccess?.();
      queueMicrotask(() => this.transaction?.oncomplete?.());
    });
    return request;
  }

  delete(key: string) {
    const request = new FakeRequest<unknown>();
    queueMicrotask(() => {
      this.store.delete(key);
      request.onsuccess?.();
      queueMicrotask(() => this.transaction?.oncomplete?.());
    });
    return request;
  }
}

function makeFakeIndexedDb() {
  const databases = new Map<string, FakeDatabase>();
  return {
    open(name: string) {
      const request = new FakeRequest<FakeDatabase>();
      queueMicrotask(() => {
        let database = databases.get(name);
        if (!database) {
          database = new FakeDatabase();
          databases.set(name, database);
          request.result = database;
          request.onupgradeneeded?.();
        }
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase(name: string) {
      const request = new FakeRequest<void>();
      queueMicrotask(() => {
        databases.delete(name);
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
}

describe("web scanner restart persistence", () => {
  const values = new Map<string, string>();
  let failWrites = false;

  beforeEach(() => {
    vi.stubGlobal("indexedDB", makeFakeIndexedDb());
    values.clear();
    failWrites = false;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (failWrites) throw new Error("storage unavailable");
          values.set(key, value);
        },
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  it("encrypts queued badge credentials and restores them for the same owner", async () => {
    await saveOfflineQueue(7, [saved]);
    const [stored] = [...values.values()];

    expect(stored).toBeDefined();
    expect(stored).not.toContain("BADGE-7");
    expect(stored).not.toContain("Dinner");
    expect(await loadOfflineQueue(7)).toEqual([saved]);
    expect(await loadOfflineQueue(8)).toEqual([]);
  });

  it("discards the legacy plaintext queue instead of retaining or replaying it", async () => {
    values.set("hackos:logistics:meal-scans", JSON.stringify([saved]));

    expect(await loadOfflineQueue(7)).toEqual([]);
    expect(values.has("hackos:logistics:meal-scans")).toBe(false);
  });

  it("discards corrupt encrypted state and its key", async () => {
    await saveOfflineQueue(7, [saved]);
    const [key] = [...values.keys()];
    values.set(key, "not-json");

    expect(await loadOfflineQueue(7)).toEqual([]);
    expect(values.has(key)).toBe(false);
  });

  it("clears the owner queue during account closure", async () => {
    await saveOfflineQueue(7, [saved]);
    await saveOfflineQueue(8, [{ ...saved, clientScanId: "other-owner-operation" }]);

    await clearOfflineQueue(7);

    expect(values.size).toBe(1);
    expect(await loadOfflineQueue(7)).toEqual([]);
    expect(await loadOfflineQueue(8)).toEqual([
      { ...saved, clientScanId: "other-owner-operation" },
    ]);
  });

  it("never broadens ownerless cleanup into another account's queue", async () => {
    await saveOfflineQueue(7, [saved]);
    await saveOfflineQueue(8, [{ ...saved, clientScanId: "other-owner-operation" }]);

    await clearOfflineQueue(null);

    expect(await loadOfflineQueue(7)).toEqual([saved]);
    expect(await loadOfflineQueue(8)).toEqual([
      { ...saved, clientScanId: "other-owner-operation" },
    ]);
  });

  it("serializes owner queue read-modify-write updates without losing an enqueue", async () => {
    await saveOfflineQueue(7, [saved]);
    const first = { ...saved, clientScanId: "concurrent-first" };
    const second = { ...saved, clientScanId: "concurrent-second" };

    await Promise.all([
      updateOfflineQueue(7, (items) => [...items, first]),
      updateOfflineQueue(7, (items) => [...items, second]),
    ]);

    expect(await loadOfflineQueue(7)).toEqual([saved, first, second]);
  });

  it("keeps the durable queue when replacing it fails", async () => {
    const later = { ...saved, clientScanId: "later-operation" };
    await saveOfflineQueue(7, [saved, later]);

    failWrites = true;
    await expect(
      updateOfflineQueue(7, (items) =>
        items.filter((item) => item.clientScanId !== saved.clientScanId),
      ),
    ).rejects.toThrow("storage unavailable");
    failWrites = false;

    expect(await loadOfflineQueue(7)).toEqual([saved, later]);
  });

  it("releases a persisted syncing lease after a restart", async () => {
    await saveOfflineQueue(7, [{ ...saved, status: "syncing" }]);

    expect(await loadOfflineQueue(7)).toEqual([saved]);
  });

  it("does not load a queue without an authenticated owner", async () => {
    await saveOfflineQueue(7, [saved]);

    expect(await loadOfflineQueue(null)).toEqual([]);
  });

  it.each([
    "not_found",
    "badge_unknown",
    "badge_revoked",
    "ticket_revoked",
    "badge_scan_before_assignment",
  ])("recognizes %s as a stale participant rejection", (code) => {
    expect(isStaleOfflineScanError({ code })).toBe(true);
  });

  it("does not discard a queue for an unrelated server error", () => {
    expect(isStaleOfflineScanError({ code: "temporary_failure" })).toBe(false);
    expect(isStaleOfflineScanError(new Error("offline"))).toBe(false);
  });
});
