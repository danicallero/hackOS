/**
 * Idempotency keys represent user intent (#995): the key for a mutation is
 * minted on first send and reused for every re-send of the identical request
 * (same method, path and payload) until the server gave a definitive answer.
 * A timeout or lost response followed by the user pressing the button again
 * therefore replays the first result instead of executing twice; a changed
 * payload is a new intent and gets a new key.
 */

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 200;
const pending = new Map<string, { key: string; at: number }>();

/** Statuses that mean "outcome unknown or still running": keep the key. */
const RETRYABLE = new Set([408, 409, 425, 429]);

export function intentKey(signature: string): string {
  const now = Date.now();
  const hit = pending.get(signature);
  if (hit && now - hit.at < TTL_MS) return hit.key;
  const key = crypto.randomUUID();
  pending.delete(signature);
  pending.set(signature, { key, at: now });
  if (pending.size > MAX_ENTRIES) pending.delete(pending.keys().next().value as string);
  return key;
}

/** Call once the request produced a response (or none, for a transport failure). */
export function settleIntentKey(signature: string, status: number | null): void {
  if (status === null || status >= 500 || RETRYABLE.has(status)) return;
  pending.delete(signature);
}
