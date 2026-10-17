/** Spread of public-surface refetches after a payload-free SSE signal (see useJitteredCallback). */
export const PUBLIC_REFRESH_JITTER_MS = 3_000;
/**
 * Wall displays show the live queue (rooms advance at any moment), so they
 * refetch almost at once; the shared cache is invalidated by every queue event.
 */
export const TV_REFRESH_JITTER_MS = 250;
