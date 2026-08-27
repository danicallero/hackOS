import * as SecureStore from "expo-secure-store";

export type AccountRemovalProgressStatus = "pending_exit" | "processing" | "device_cleanup_pending";

export interface AccountRemovalProgress {
  action: "delete" | "anonymize";
  status: AccountRemovalProgressStatus;
}

// Deliberately contains no user ID, email, or server identifier. It survives
// the Better Auth session cleanup so a restarted app can explain an accepted
// pending-exit request to the signed-out user.
const ACCOUNT_REMOVAL_PROGRESS_KEY = "hackos_account_removal_progress";

export async function saveAccountRemovalProgress(progress: AccountRemovalProgress): Promise<void> {
  try {
    await SecureStore.setItemAsync(ACCOUNT_REMOVAL_PROGRESS_KEY, JSON.stringify(progress), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Secure-store failure must not block server-side account closure.
  }
}

export async function readAccountRemovalProgress(): Promise<AccountRemovalProgress | null> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNT_REMOVAL_PROGRESS_KEY);
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

export async function clearAccountRemovalProgress(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ACCOUNT_REMOVAL_PROGRESS_KEY, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The marker is non-sensitive and best-effort cleanup is sufficient.
  }
}
