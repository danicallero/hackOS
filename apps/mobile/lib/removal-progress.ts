import {
  type AccountRemovalProgress,
  parseAccountRemovalProgress,
} from "@hackos/shared/account-removal";
import * as SecureStore from "expo-secure-store";

export type {
  AccountRemovalAction,
  AccountRemovalProgress,
  AccountRemovalProgressStatus,
} from "@hackos/shared/account-removal";

// H54: this non-identifying marker survives session cleanup for pending exits.
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
    return parseAccountRemovalProgress(raw);
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
