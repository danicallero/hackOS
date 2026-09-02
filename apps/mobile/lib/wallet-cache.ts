import { apiFetch } from "./api";
import { readCachedValue, writeCachedValue } from "./offline-cache";

export interface WalletTicketPayload {
  userId: number;
  ticketToken: string | null;
  badgeId: string | null;
  applePassTypeIdentifier: string;
  applePassSerialNumbers: { ticket: string | null; badge: string | null };
  acceptedSpots: Array<{
    responseId: number;
    applicationName: string;
    // H8: `badge_category` retired — the API now returns the granted role's
    // real (admin-editable) name here instead of a fixed category value.
    grantedRoleName: string | null;
    expiresAt: string | null;
  }>;
}

/** H28: keep each account's ticket details isolated in the persistent app cache. */
export function walletCacheKey(userId: number): string {
  return `user:${userId}:wallet`;
}

/**
 * Best-effort startup warmup so Wallet remains useful when connectivity drops
 * before the user visits its tab. Existing data is left for the Wallet screen
 * to refresh, avoiding an extra request on every app foreground.
 */
export async function warmWalletCache(userId: number): Promise<void> {
  const cacheKey = walletCacheKey(userId);
  if (await readCachedValue<WalletTicketPayload>(cacheKey)) return;

  try {
    const payload = await apiFetch<WalletTicketPayload>("/api/me/ticket");
    await writeCachedValue(cacheKey, payload);
  } catch {
    // Warmup is best-effort; the Wallet screen owns loading and retry feedback.
  }
}
