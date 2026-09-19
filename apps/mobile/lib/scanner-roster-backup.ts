import { clearCachedValue, readCachedValue, writeCachedValue } from "./offline-cache";
import { decryptJson, encryptJson, getRosterKey } from "./scanner-crypto";
import type { ScannerSnapshot } from "./scanner-types";

// This is the canonical cold-start backup. expo-sqlite/kv-store is the same
// durable store that already preserves Schedule across a terminated app; the
// scanner database is only an indexed working copy.
const ROSTER_BACKUP_KEY = "scanner:roster:v1";

type StoredRoster = { ciphertext: string };

export async function saveRosterBackup(snapshot: ScannerSnapshot): Promise<void> {
  const ciphertext = await encryptJson(snapshot, await getRosterKey());
  await writeCachedValue<StoredRoster>(ROSTER_BACKUP_KEY, { ciphertext }, snapshot.generatedAt);
}

export async function loadRosterBackup(): Promise<ScannerSnapshot | null> {
  const stored = await readCachedValue<StoredRoster>(ROSTER_BACKUP_KEY);
  if (!stored?.data.ciphertext) return null;
  try {
    return await decryptJson<ScannerSnapshot>(stored.data.ciphertext, await getRosterKey());
  } catch {
    return null;
  }
}

export async function clearRosterBackup(): Promise<void> {
  await clearCachedValue(ROSTER_BACKUP_KEY);
}
