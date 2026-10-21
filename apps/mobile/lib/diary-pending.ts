import { ApiError } from "./api";
import { readCachedValue, writeCachedValue } from "./offline-cache";

/** A badge code scanned without a connection, waiting to become a contact. */
export interface PendingDiaryScan {
  code: string;
  scannedAt: string;
}

/** Under the account's `user:<id>:` prefix, so sign-out clears it with the other caches. */
const key = (userId: number) => `user:${userId}:diary-pending-scans`;

/** True when the request never reached the server (no status), not when it was refused. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError ? !error.status : error instanceof TypeError;
}

export async function readPendingScans(userId: number): Promise<PendingDiaryScan[]> {
  return (await readCachedValue<PendingDiaryScan[]>(key(userId)))?.data ?? [];
}

/** Keeps one entry per code: scanning the same badge twice offline is one contact. */
export async function enqueuePendingScan(
  userId: number,
  code: string,
): Promise<PendingDiaryScan[]> {
  const current = await readPendingScans(userId);
  if (current.some((scan) => scan.code === code)) return current;
  const next = [...current, { code, scannedAt: new Date().toISOString() }];
  await writeCachedValue(key(userId), next);
  return next;
}

/**
 * Submits queued scans in order. A scan the server answers (accepted or
 * refused, for example a hidden profile) leaves the queue; the first transport
 * failure stops the run and keeps the rest for the next reconnect.
 */
export async function flushPendingScans(
  userId: number,
  submit: (code: string) => Promise<unknown>,
): Promise<{ sent: number; remaining: PendingDiaryScan[] }> {
  const queue = await readPendingScans(userId);
  let sent = 0;
  let index = 0;
  for (; index < queue.length; index += 1) {
    try {
      await submit(queue[index].code);
      sent += 1;
    } catch (error) {
      if (isOfflineError(error)) break;
    }
  }
  const remaining = queue.slice(index);
  if (remaining.length !== queue.length) await writeCachedValue(key(userId), remaining);
  return { sent, remaining };
}
