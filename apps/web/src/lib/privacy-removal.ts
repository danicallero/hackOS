export type AccountRemovalAction = "delete" | "anonymize";

export interface AccountRemovalEligibility {
  action: AccountRemovalAction;
  reasonCode: string;
  accessRevoked: true;
  operationalHistoryRetained: boolean;
  activeEventConsequences: boolean;
  requiresVenueExit: boolean;
  retainedFields: string[];
}

export function accountRemovalRequest(userId: number, action: AccountRemovalAction) {
  return action === "delete"
    ? { method: "DELETE" as const, path: `/api/users/${userId}` }
    : { method: "POST" as const, path: `/api/users/${userId}/anonymize` };
}

/** A fresh key makes every destructive attempt one idempotent operation. */
export function accountRemovalIdempotencyKey(action: AccountRemovalAction): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `account-${action}-${random}`;
}

/**
 * Remove browser-held app data after the server has accepted account closure.
 * The web app currently stores preferences and the staff meal queue in
 * browser storage; clearing the app-owned namespaces also covers future
 * account-scoped keys without touching unrelated origins.
 */
export function clearWebAccountData(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("hackos") || key.startsWith("queue-ops-")) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Private browsing/storage restrictions must not prevent sign-out.
  }
  try {
    window.sessionStorage.clear();
  } catch {
    // Private browsing/storage restrictions must not prevent sign-out.
  }
}
