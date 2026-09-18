import { expoClient } from "@better-auth/expo/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import type { ApiMode } from "./api-mode";
import { API_URL } from "./env";
import { notifySignOut } from "./sign-out-events";

/**
 * Better Auth client for the Expo app (H4, H55). Points at the same Better
 * Auth instance as `apps/web/src/lib/auth-client.ts`, but sessions live in
 * `expo-secure-store` instead of a browser cookie jar — the `expoClient`
 * plugin pairs with the server's `expo()` plugin
 * (apps/api/src/modules/identity/auth.ts) to stamp the app's custom scheme
 * on the Origin header and manage the deep-link auth redirect.
 */
function createMobileAuthClient(mode: ApiMode = "production") {
  return createAuthClient({
    baseURL: API_URL,
    plugins: [
      expoClient({
        scheme: "hackos",
        // Production retains the original key for existing installs. A dev
        // session must never be sent to the production origin (or vice versa).
        storagePrefix: mode === "development" ? "hackos-dev" : "hackos",
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

/** Lets the shared /api/me store clear immediately after any sign-out path. */
export async function signOut() {
  const result = await authClient.signOut();
  if (!result.error) notifySignOut();
  return result;
}
