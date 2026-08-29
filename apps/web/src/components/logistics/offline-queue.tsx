import { AlertTriangleIcon, CloudOffIcon, HardDriveIcon, LoaderCircleIcon } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";

/** A meal scan captured on-device and awaiting server confirmation (H25). */
export type OfflineScan = {
  clientScanId: string;
  activityId: number;
  activityName: string;
  badgeId: string;
  allowRepeat: boolean;
  scannedAt: string;
  status: "pending" | "syncing" | "failed";
  failureKind?: "offline" | "rejected";
  error?: string;
};

/** Server responses that prove a queued badge can never be replayed. */
export function isStaleOfflineScanError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === "string" &&
    [
      "not_found",
      "badge_unknown",
      "badge_revoked",
      "ticket_revoked",
      "badge_scan_before_assignment",
    ].includes(code)
  );
}

export const LEGACY_OFFLINE_KEY = "hackos:logistics:meal-scans";
export const OFFLINE_KEY_PREFIX = "hackos:logistics:meal-scans:v2:";
const KEY_DATABASE = "hackos-logistics-offline-queue";
const KEY_STORE = "keys";
const QUEUE_VERSION = 2;
const queueGenerations = new Map<number, number>();
let queueOperationChain: Promise<unknown> = Promise.resolve();

type QueueEnvelope = {
  version: typeof QUEUE_VERSION;
  iv: string;
  ciphertext: string;
};

type QueuePayload = {
  version: typeof QUEUE_VERSION;
  ownerId: number;
  items: OfflineScan[];
};

type StoredKey = {
  slot: string;
  key: CryptoKey;
};

function withSerializedQueueOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = queueOperationChain.then(operation);
  queueOperationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function queueGeneration(ownerId: number): number {
  return queueGenerations.get(ownerId) ?? 0;
}

function advanceQueueGeneration(ownerId: number): number {
  const next = queueGeneration(ownerId) + 1;
  queueGenerations.set(ownerId, next);
  return next;
}

/** True for both the pre-H54 plaintext key and encrypted owner envelopes. */
export function isOfflineQueueStorageKey(key: string): boolean {
  return key === LEGACY_OFFLINE_KEY || key.startsWith(OFFLINE_KEY_PREFIX);
}

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable; offline queue persistence is disabled");
  }
  return globalThis.crypto;
}

function bytesToBase64(bytes: ArrayBuffer | ArrayBufferView): string {
  let binary = "";
  const view = !ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function ownerSlot(ownerId: number): Promise<string> {
  const input = new TextEncoder().encode(`hackos-offline-meal-queue:${ownerId}`);
  return bytesToBase64(await webCrypto().subtle.digest("SHA-256", input));
}

function openKeyDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is unavailable; offline queue persistence is disabled"),
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE, { keyPath: "slot" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open offline queue key store"));
  });
}

async function readStoredKey(slot: string): Promise<CryptoKey | null> {
  const database = await openKeyDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(slot);
      request.onsuccess = () => resolve((request.result as StoredKey | undefined)?.key ?? null);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read offline queue key"));
    });
  } finally {
    database.close();
  }
}

async function getOrCreateKey(slot: string): Promise<CryptoKey> {
  const existing = await readStoredKey(slot);
  if (existing) return existing;

  const key = await webCrypto().subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const database = await openKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(KEY_STORE, "readwrite");
      const request = transaction.objectStore(KEY_STORE).put({ slot, key } satisfies StoredKey);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not save offline queue key"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not save offline queue key"));
    });
  } finally {
    database.close();
  }
  return key;
}

async function deleteStoredKey(slot: string): Promise<void> {
  const database = await openKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(KEY_STORE, "readwrite");
      const request = transaction.objectStore(KEY_STORE).delete(slot);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not remove offline queue key"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not remove offline queue key"));
    });
  } finally {
    database.close();
  }
}

function isOfflineScan(value: unknown): value is OfflineScan {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OfflineScan>;
  return (
    typeof item.clientScanId === "string" &&
    typeof item.activityId === "number" &&
    typeof item.activityName === "string" &&
    typeof item.badgeId === "string" &&
    typeof item.allowRepeat === "boolean" &&
    typeof item.scannedAt === "string" &&
    (item.status === "pending" || item.status === "syncing" || item.status === "failed")
  );
}

function queueStorageKey(slot: string): string {
  return `${OFFLINE_KEY_PREFIX}${slot}`;
}

function removeStoredQueue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing; there is no plaintext
    // fallback, so an unreadable queue is intentionally not replayed.
  }
}

/**
 * Load only the queue encrypted for the currently authenticated staff owner.
 * The old plaintext array and corrupt/encrypted-with-another-owner state are
 * explicitly discarded instead of being retained or replayed.
 */
async function loadOfflineQueueUnlocked(ownerId: number | null): Promise<OfflineScan[]> {
  if (ownerId === null) return [];

  let slot: string;
  try {
    slot = await ownerSlot(ownerId);
  } catch {
    return [];
  }

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LEGACY_OFFLINE_KEY);
    if (raw !== null) {
      removeStoredQueue(LEGACY_OFFLINE_KEY);
      return [];
    }
    raw = window.localStorage.getItem(queueStorageKey(slot));
  } catch {
    return [];
  }
  if (raw === null) return [];

  try {
    const envelope = JSON.parse(raw) as Partial<QueueEnvelope>;
    if (
      envelope.version !== QUEUE_VERSION ||
      typeof envelope.iv !== "string" ||
      typeof envelope.ciphertext !== "string"
    ) {
      throw new Error("invalid offline queue envelope");
    }
    const key = await readStoredKey(slot);
    if (!key) throw new Error("offline queue key is missing");
    const additionalData = new TextEncoder().encode(`hackos-offline-owner:${ownerId}`);
    const plaintext = await webCrypto().subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData },
      key,
      base64ToBytes(envelope.ciphertext),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<QueuePayload>;
    if (
      payload.version !== QUEUE_VERSION ||
      payload.ownerId !== ownerId ||
      !Array.isArray(payload.items) ||
      !payload.items.every(isOfflineScan)
    ) {
      throw new Error("invalid offline queue payload");
    }
    // "syncing" is an in-memory lease, not a durable terminal state. A tab
    // that closes mid-replay must make the item eligible on the next load.
    return payload.items.map((item) =>
      item.status === "syncing" ? { ...item, status: "pending" as const } : item,
    );
  } catch {
    // A corrupt, stale, legacy, or owner-mismatched queue must not survive as
    // an indefinitely retained identity-bearing badge credential.
    removeStoredQueue(queueStorageKey(slot));
    try {
      await deleteStoredKey(slot);
    } catch {
      // The ciphertext has already been removed; an orphaned key contains no
      // participant data and cannot decrypt a future owner's queue.
    }
    return [];
  }
}

async function saveOfflineQueueUnlocked(
  ownerId: number,
  items: OfflineScan[],
  generation: number,
): Promise<void> {
  // Remove the pre-H54 plaintext namespace before doing any new persistence,
  // including when encryption or browser storage later fails.
  removeStoredQueue(LEGACY_OFFLINE_KEY);
  const slot = await ownerSlot(ownerId);
  const key = await getOrCreateKey(slot);
  const payload: QueuePayload = { version: QUEUE_VERSION, ownerId, items };
  const iv = new Uint8Array(new ArrayBuffer(12));
  webCrypto().getRandomValues(iv);
  const additionalData = new TextEncoder().encode(`hackos-offline-owner:${ownerId}`);
  const ciphertext = await webCrypto().subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const envelope: QueueEnvelope = {
    version: QUEUE_VERSION,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
  if (generation !== queueGeneration(ownerId)) {
    throw new Error("Offline queue was cleared while it was being saved");
  }
  window.localStorage.setItem(queueStorageKey(slot), JSON.stringify(envelope));
}

/**
 * Reads the latest owner queue and persists one update while holding the same
 * browser-wide lock used by load/save/clear. Callers must use this for
 * read-modify-write changes; saving a previously rendered React snapshot can
 * otherwise lose a concurrent enqueue from another scanner surface.
 */
export async function updateOfflineQueue(
  ownerId: number,
  update: (items: OfflineScan[]) => OfflineScan[] | Promise<OfflineScan[]>,
): Promise<OfflineScan[]> {
  const generation = queueGeneration(ownerId);
  return withSerializedQueueOperation(async () => {
    const current = await loadOfflineQueueUnlocked(ownerId);
    if (generation !== queueGeneration(ownerId)) {
      throw new Error("Offline queue was cleared while it was being updated");
    }
    const next = await update(current);
    if (generation !== queueGeneration(ownerId)) {
      throw new Error("Offline queue was cleared while it was being updated");
    }
    await saveOfflineQueueUnlocked(ownerId, next, generation);
    return next;
  });
}

export function loadOfflineQueue(ownerId: number | null): Promise<OfflineScan[]> {
  return withSerializedQueueOperation(() => loadOfflineQueueUnlocked(ownerId));
}

export function saveOfflineQueue(ownerId: number, items: OfflineScan[]): Promise<void> {
  const generation = queueGeneration(ownerId);
  return withSerializedQueueOperation(() => saveOfflineQueueUnlocked(ownerId, items, generation));
}

async function clearOfflineQueueUnlocked(ownerId: number): Promise<void> {
  removeStoredQueue(LEGACY_OFFLINE_KEY);
  const slot = await ownerSlot(ownerId);
  removeStoredQueue(queueStorageKey(slot));
  await deleteStoredKey(slot);
}

/** Remove the current owner's queue and key during account closure. */
export function clearOfflineQueue(ownerId: number | null): Promise<void> {
  // An ownerless cleanup request must never broaden into deleting every
  // account's queue. The legacy plaintext key is safe to retire, but the
  // encrypted owner envelopes remain untouched until their owner is known.
  if (ownerId === null) {
    removeStoredQueue(LEGACY_OFFLINE_KEY);
    return Promise.resolve();
  }
  advanceQueueGeneration(ownerId);
  return withSerializedQueueOperation(() => clearOfflineQueueUnlocked(ownerId));
}

/** Local, not-yet-synced meal scans queued on this device (H25). */
export function OfflineQueue({ items }: { items: OfflineScan[] }) {
  const { t } = useLocale();
  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-2">
        <p className="text-sm font-medium">{t("localQueueTitle")}</p>
      </div>
      <div className="divide-y">
        {items.map((item) => (
          <div
            key={item.clientScanId}
            className="flex flex-wrap items-start justify-between gap-3 px-4 py-2"
          >
            <div className="min-w-0">
              <p className="wrap-break-word text-pretty text-sm font-medium">{item.activityName}</p>
              <p className="text-muted-foreground text-xs">
                {item.badgeId} · {new Date(item.scannedAt).toLocaleTimeString()}
              </p>
            </div>
            <div className="flex max-w-full flex-col items-end gap-1 text-right">
              <StatusBadge
                tone={
                  item.status === "failed"
                    ? "danger"
                    : item.failureKind === "offline"
                      ? "warning"
                      : item.status === "syncing"
                        ? "info"
                        : "neutral"
                }
              >
                {item.status === "failed" ? (
                  <AlertTriangleIcon aria-hidden className="size-3" />
                ) : item.failureKind === "offline" ? (
                  <CloudOffIcon aria-hidden className="size-3" />
                ) : item.status === "syncing" ? (
                  <LoaderCircleIcon aria-hidden className="size-3" />
                ) : (
                  <HardDriveIcon aria-hidden className="size-3" />
                )}
                {item.status === "failed"
                  ? t("scannerStateAttention")
                  : item.status === "syncing"
                    ? t("scannerStateSyncing")
                    : t("scannerStateSaved")}
              </StatusBadge>
              <p className="text-muted-foreground max-w-72 text-pretty text-xs">
                {item.status === "failed"
                  ? t("scannerBusinessRejected")
                  : item.failureKind === "offline"
                    ? t("scannerOfflineWaiting")
                    : t("scannerAwaitingAcknowledgement")}
              </p>
              {item.error ? (
                <p className="text-destructive max-w-72 text-pretty text-xs">{item.error}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
