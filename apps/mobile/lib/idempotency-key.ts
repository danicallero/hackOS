/**
 * React Native's runtime does not consistently expose `crypto.randomUUID`.
 * An idempotency key only needs a collision-resistant client identifier; it
 * is not an authentication secret.
 */
export function createIdempotencyKey(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
