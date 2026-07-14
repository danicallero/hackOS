import { expoClient } from "@better-auth/expo/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { API_URL } from "./env";

/**
 * Better Auth client for the Expo app (H4, H55). Points at the same Better
 * Auth instance as `apps/web/src/lib/auth-client.ts`, but sessions live in
 * `expo-secure-store` instead of a browser cookie jar — the `expoClient`
 * plugin pairs with the server's `expo()` plugin
 * (apps/api/src/modules/identity/auth.ts) to stamp the app's custom scheme
 * on the Origin header and manage the deep-link auth redirect.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: "hackos",
      storagePrefix: "hackos",
      storage: SecureStore,
    }),
    inferAdditionalFields({
      user: {
        surname: { type: "string", required: true },
        phone: { type: "string", required: false },
        language: { type: "string", required: false },
      },
    }),
  ],
});

export const { signIn, signOut, useSession } = authClient;
