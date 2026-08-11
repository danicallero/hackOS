import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { API_URL } from "./env";

/**
 * Better Auth browser client. Points at the same Better Auth instance the API
 * mounts under /api/auth (apps/api/src/modules/identity/auth.ts). All auth
 * mutations (sign-up, sign-in, sign-out, password reset, verification) flow
 * through here so the session cookie is managed in one place.
 *
 * `credentials: "include"` is required because the web app (:3001) and the API
 * (:3000) are different origins in dev; the API's CORS allows credentials.
 *
 * `inferAdditionalFields` teaches the client about the extra user columns the
 * API declares on Better Auth (surname/language) so sign-up is typed.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: "include" },
  plugins: [
    inferAdditionalFields({
      user: {
        surname: { type: "string", required: true },
        language: { type: "string", required: false },
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
