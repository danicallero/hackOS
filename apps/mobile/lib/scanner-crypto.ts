import {
  AESEncryptionKey,
  AESKeySize,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from "expo-crypto";
import * as SecureStore from "expo-secure-store";

/**
 * At-rest encryption for the two local caches a scanner device keeps:
 * the attendance roster (shared, wiped on logout) and each staff member's
 * offline scan queue (durable, kept isolated per signed-in user). Keys never
 * leave the device's Keychain/Keystore and, on iOS, are marked
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so an iCloud/iTunes backup of the
 * encrypted SQLite files cannot be restored to a different device and read.
 */

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const ROSTER_KEY_NAME = "scanner-roster-key";
const queueKeyName = (userId: number) => `scanner-queue-key-${userId}`;

async function loadOrCreateKey(name: string): Promise<AESEncryptionKey> {
  const stored = await SecureStore.getItemAsync(name, SECURE_STORE_OPTIONS);
  if (stored) return AESEncryptionKey.import(stored, "base64");
  const key = await AESEncryptionKey.generate(AESKeySize.AES256);
  const encoded = await key.encoded("base64");
  await SecureStore.setItemAsync(name, encoded, SECURE_STORE_OPTIONS);
  return key;
}

let rosterKey: Promise<AESEncryptionKey> | null = null;

/** Roster key is regenerated every time the roster is wiped (see resetRosterKey). */
export function getRosterKey(): Promise<AESEncryptionKey> {
  if (!rosterKey) rosterKey = loadOrCreateKey(ROSTER_KEY_NAME);
  return rosterKey;
}

/** Drops the roster key alongside the roster data itself on logout. */
export async function resetRosterKey(): Promise<void> {
  rosterKey = null;
  await SecureStore.deleteItemAsync(ROSTER_KEY_NAME, SECURE_STORE_OPTIONS);
}

const queueKeys = new Map<number, Promise<AESEncryptionKey>>();

/**
 * Each signed-in user's offline scan queue is encrypted with its own key, so
 * a different staff member signing in on the same device cannot decrypt (or
 * even meaningfully query — see scanner-db's created_by_user_id scoping) a
 * predecessor's still-unsynced scans. The key is never deleted on logout:
 * that's what lets the same user sign back in later and recover their own
 * queued conflicts.
 */
export function getQueueKey(userId: number): Promise<AESEncryptionKey> {
  let key = queueKeys.get(userId);
  if (!key) {
    key = loadOrCreateKey(queueKeyName(userId));
    queueKeys.set(userId, key);
  }
  return key;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodes a base64 string into raw bytes without relying on `atob`/`Buffer`
 * globals, which aren't guaranteed to exist in every RN/Hermes + web
 * environment this module runs in.
 *
 * expo-crypto's TS types claim `AESSealedData.fromCombined` accepts a plain
 * base64 string (`BinaryInput = string | Uint8Array | ArrayBuffer`), and
 * that's true for the web and iOS native bridges. On Android, though, the
 * native bridge throws `"Value is a string, expected an Object"` — it only
 * accepts decoded bytes. Decoding to a `Uint8Array` ourselves before calling
 * into the bridge works identically on all three platforms, so we always do
 * it rather than relying on the (Android-incompatible) string overload.
 */
function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

export async function encryptJson(value: unknown, key: AESEncryptionKey): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const sealed = await aesEncryptAsync(bytes, key);
  return sealed.combined("base64");
}

export async function decryptJson<T>(combined: string, key: AESEncryptionKey): Promise<T> {
  const sealed = AESSealedData.fromCombined(base64ToBytes(combined));
  const bytes = await aesDecryptAsync(sealed, key, { output: "bytes" });
  return JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as T;
}
