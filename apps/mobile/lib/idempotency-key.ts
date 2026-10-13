/**
 * React Native's runtime does not consistently expose `crypto.randomUUID`.
 * An idempotency key only needs a collision-resistant client identifier; it
 * is not an authentication secret.
 */
export function createIdempotencyKey(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Idempotency keys represent user intent (#995): the key is minted on the first
 * send of a request and reused for every re-send of the identical request
 * (method, path, body) until the server gave a definitive answer, so pressing
 * a button again after a lost response replays the first result. A changed
 * payload is a new intent and gets a new key.
 */
const INTENT_TTL_MS = 10 * 60_000;
const INTENT_MAX_ENTRIES = 200;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);
const pendingIntents = new Map<string, { key: string; at: number }>();

export function intentKey(signature: string): string {
  const now = Date.now();
  const hit = pendingIntents.get(signature);
  if (hit && now - hit.at < INTENT_TTL_MS) return hit.key;
  const key = createIdempotencyKey();
  pendingIntents.delete(signature);
  pendingIntents.set(signature, { key, at: now });
  if (pendingIntents.size > INTENT_MAX_ENTRIES) {
    pendingIntents.delete(pendingIntents.keys().next().value as string);
  }
  return key;
}

/** `status` is null for a transport failure, which keeps the key for the retry. */
export function settleIntentKey(signature: string, status: number | null): void {
  if (status === null || status >= 500 || RETRYABLE_STATUSES.has(status)) return;
  pendingIntents.delete(signature);
}
