import { expoClient } from "@better-auth/expo/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import type { ApiMode } from "./api-mode";
import { API_URL } from "./env";
import { notifySignOut } from "./sign-out-events";

const STORAGE_PREFIX = "hackos";
let activeStoragePrefix = STORAGE_PREFIX;

/**
 * Better Auth client for the Expo app (H4, H55). Points at the same Better
 * Auth instance as `apps/web/src/lib/auth-client.ts`, but sessions live in
 * `expo-secure-store` instead of a browser cookie jar — the `expoClient`
 * plugin pairs with the server's `expo()` plugin
 * (apps/api/src/modules/identity/auth.ts) to stamp the app's custom scheme
 * on the Origin header and manage the deep-link auth redirect.
 */
function createMobileAuthClient(mode: ApiMode = "production") {
  activeStoragePrefix = mode === "development" ? "hackos-dev" : STORAGE_PREFIX;
  return createAuthClient({
    baseURL: API_URL,
    plugins: [
      expoClient({
        scheme: "hackos",
        // Production retains the original key for existing installs. A dev
        // session must never be sent to the production origin (or vice versa).
        storagePrefix: activeStoragePrefix,
        storage: SecureStore,
      }),
      inferAdditionalFields({
        user: {
          surname: { type: "string", required: true },
          language: { type: "string", required: false },
        },
      }),
    ],
  });
}

export let authClient = createMobileAuthClient();

/** Rebuild Better Auth because its base URL and SecureStore namespace are immutable. */
export function configureAuthClient(mode: ApiMode): void {
  authClient = createMobileAuthClient(mode);
}

// Keep this export stable for forms while resolving the active client at the
// moment the user submits, after an endpoint switch has rebuilt it.
export const signIn = {
  email: (...args: Parameters<typeof authClient.signIn.email>) => authClient.signIn.email(...args),
};

const sessionCookieKey = () => `${activeStoragePrefix}_cookie`;
const sessionDataKey = () => `${activeStoragePrefix}_session_data`;
// The expo plugin mirrors the browser cookie jar and session JSON in
// expo-secure-store, chunking larger payloads as "key.0..N" with the base key
// holding "\u0001ba-chunks:<count>". Sign-out must drop the chunked keys too,
// or token material lingers on the device.
const CHUNK_MARKER = "\u0001ba-chunks:";

async function deleteStoredKey(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Local sign-out must never fail: SecureStore errors are swallowed so a
    // device without reachable storage still lands on the sign-in screen.
  }
}

async function clearSecureStoreSessionKey(baseKey: string): Promise<void> {
  const stored = await SecureStore.getItemAsync(baseKey);
  if (stored?.startsWith(CHUNK_MARKER)) {
    const count = Number(stored.slice(CHUNK_MARKER.length));
    if (Number.isInteger(count) && count > 0) {
      await Promise.all(
        Array.from({ length: count }, (_, index) => deleteStoredKey(`${baseKey}.${index}`)),
      );
    }
  }
  await deleteStoredKey(baseKey);
}

/** Wipes the on-device session's SecureStore keys. */
async function clearStoredSession(): Promise<void> {
  try {
    await Promise.all([
      clearSecureStoreSessionKey(sessionCookieKey()),
      clearSecureStoreSessionKey(sessionDataKey()),
    ]);
  } catch {
    // Swallowed — see deleteStoredKey.
  }
}

/** Wipes the in-memory Better Auth session atom. */
function clearSessionAtom(): void {
  try {
    const sessionAtom = authClient.$store.atoms.session;
    sessionAtom.set({ ...sessionAtom.get(), data: null, error: null, isPending: false });
  } catch {
    // Swallowed — the atom is only a mirror; storage is already cleared.
  }
}

/** Wipes the on-device session (SecureStore keys + in-memory session atom). */
async function clearLocalSession(): Promise<void> {
  await clearStoredSession();
  clearSessionAtom();
}

/**
 * H4/#757: provide an immediate local escape when a sign-out attempt has
 * already failed in the UI. SecureStore cleanup continues in the background,
 * but navigation must never depend on it completing.
 */
export function forceLocalSignOut(): void {
  void clearStoredSession();
  clearSessionAtom();
  try {
    notifySignOut();
  } catch {
    // A listener failure must not prevent the caller from replacing the route.
  }
}

/** Best-effort server-side revocation, fired after the device is signed out. */
async function revokeServerSession(sessionCookie: string): Promise<void> {
  try {
    await authClient.$fetch(`${API_URL.replace(/\/+$/, "")}/api/auth/sign-out`, {
      method: "POST",
      onRequest: ({ headers }) => headers.set("cookie", sessionCookie),
    });
  } catch {
    // Best effort — the device is already signed out locally; a failed server
    // revocation must never surface as an error to the user.
  }
}

/**
 * Unlike normal local-first sign-out, an API endpoint transition must confirm
 * that the old server revoked the session before it may point at a new server.
 */
export async function closeSessionForEnvironmentChange(): Promise<void> {
  const sessionCookie = authClient.getCookie();
  if (!sessionCookie) return;
  const result = (await authClient.$fetch(`${API_URL.replace(/\/+$/, "")}/api/auth/sign-out`, {
    method: "POST",
    onRequest: ({ headers }) => headers.set("cookie", sessionCookie),
  })) as { error?: { message?: string } | null };
  if (result.error) throw new Error(result.error.message || "Could not close the previous session");
}

/**
 * Signs out locally first and immediately: clears the on-device session so a
 * user is never stuck signed-in-looking when the server is unreachable, then
 * tells the shared /api/me store to clear, then revokes the server session as
 * a fire-and-forget request that never blocks or reports an error.
 */
export async function signOut(): Promise<Awaited<ReturnType<typeof authClient.signOut>>> {
  let sessionCookie = "";
  try {
    sessionCookie = authClient.getCookie();
  } catch {
    // Swallowed — see deleteStoredKey.
  }
  await clearLocalSession();
  notifySignOut();
  if (sessionCookie) void revokeServerSession(sessionCookie);
  return { data: { success: true }, error: null };
}
