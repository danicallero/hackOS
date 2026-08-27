export type AccountRemovalAction = "delete" | "anonymize";

export type AccountRemovalProgressStatus = "pending_exit" | "processing" | "device_cleanup_pending";

export interface AccountRemovalProgress {
  action: AccountRemovalAction;
  status: AccountRemovalProgressStatus;
}

const ACCOUNT_REMOVAL_PROGRESS_KEY = "hackos:account-removal-progress";

export interface AccountRemovalEligibility {
  action: AccountRemovalAction;
  reasonCode: string;
  accessRevoked: true;
  operationalHistoryRetained: boolean;
  activeEventConsequences: boolean;
  requiresVenueExit: boolean;
  integrityWarning: boolean;
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

/**
 * Keep only non-identifying progress after the server has revoked access.
 * This lets a signed-out user understand a pending venue exit or retryable
 * cleanup after restarting the browser without retaining their account ID.
 */
export function saveAccountRemovalProgress(progress: AccountRemovalProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACCOUNT_REMOVAL_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Storage restrictions must not prevent the account from being closed.
  }
}

export function readAccountRemovalProgress(): AccountRemovalProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_REMOVAL_PROGRESS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (
      (value.action !== "delete" && value.action !== "anonymize") ||
      (value.status !== "pending_exit" &&
        value.status !== "processing" &&
        value.status !== "device_cleanup_pending")
    ) {
      return null;
    }
    return { action: value.action, status: value.status };
  } catch {
    return null;
  }
}

export function clearAccountRemovalProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACCOUNT_REMOVAL_PROGRESS_KEY);
  } catch {
    // Storage restrictions must not prevent the signed-out flow.
  }
}
