import { betterAuth } from "better-auth";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { enqueueAuthEmail } from "./outbox.js";

/**
 * Origins Better Auth accepts on state-changing auth requests. This is a
 * SEPARATE check from CORS: even with permissive CORS, Better Auth 403s a
 * sign-in whose Origin isn't trusted ("Invalid origin"). The web app runs on a
 * different origin than the API, so it must be listed here. We derive it from
 * the same CORS_ORIGINS the proxy/CORS layer uses (so ops configure one list),
 * plus the API's own base URL and, in dev, the local Next server (:3001).
 */
// Normalize to a bare origin (no trailing slash): Better Auth's callbackURL
// check compares `trustedOrigins entry === new URL(callbackURL).origin`, so a
// trailing slash in WEB_URL/CORS_ORIGINS would fail the match and 403 with
// INVALID_CALLBACK_URL / Invalid origin.
const stripSlash = (s: string) => s.replace(/\/+$/, "");
const WEB_URL = stripSlash(config.WEB_URL);
const webOrigins = config.CORS_ORIGINS.split(",")
  .map((o) => stripSlash(o.trim()))
  .filter(Boolean);
const trustedOrigins = [
  config.BETTER_AUTH_URL,
  WEB_URL,
  ...webOrigins,
  ...(config.isProd ? [] : ["http://localhost:3001"]),
];

/**
 * Turn a Better Auth email link (which points at the API's verify endpoint)
 * into one that redirects the browser back to a real frontend page after the
 * action, instead of dumping a raw API JSON response. The token is preserved;
 * only the post-action `callbackURL` is set to the web app (WEB_URL, which is
 * in trustedOrigins above).
 */
function withFrontendCallback(token: string, path: string): string {
  const callbackURL = `${WEB_URL}${path}`;
  const params = new URLSearchParams({ token, callbackURL });
  return `${config.BETTER_AUTH_URL}/api/auth/verify-email?${params.toString()}`;
}

/**
 * Better Auth instance (H1-H5), mounted inside the Fastify API under
 * /api/auth/* (src/modules/identity/index.ts). Design decisions:
 *
 * - `database: pool` — the raw `pg.Pool` shared with the rest of the app.
 *   Better Auth detects it as a node-postgres pool (duck-typed on `.connect`)
 *   and wraps it in its own Kysely PostgresDialect internally; we never hand
 *   it a second connection pool.
 * - `user.modelName: "users"` + `fields` — Better Auth's user model is NOT a
 *   separate table. It's pointed at the EXISTING `users` table from
 *   0001_initial.sql, camelCase fields mapped to our snake_case columns.
 *   `additionalFields` covers only what Better Auth itself writes at
 *   sign-up/verification time (surname, phone, language); shirt size, food
 *   intolerances, dni, badge id etc. live on the same table but are only
 *   ever touched by this module's own /me and staff routes (profile.ts),
 *   never by Better Auth.
 * - `advanced.database.generateId: "serial"` is the 1.6.x spelling of what
 *   older Better Auth docs call `useNumberId: true` — it defers id
 *   generation to Postgres's own `GENERATED ALWAYS AS IDENTITY`, matching
 *   every other table in this schema instead of Better Auth's default
 *   random-string ids.
 * - `sessions` / `accounts` / `verifications` are hand-written in
 *   db/migrations/0101_better_auth.sql; the `fields` maps below must match
 *   that migration column-for-column.
 * - `emailAndPassword.autoSignIn: false` is what turns on Better Auth's
 *   built-in generic-duplicate-response path on sign-up (see
 *   node_modules/better-auth dist/api/routes/sign-up.mjs
 *   `shouldReturnGenericDuplicateResponse`): signing up with an email that
 *   already exists returns the exact same `{ token: null, user }` shape as a
 *   real sign-up, so the response never reveals whether the account existed
 *   (H1). Same mechanism is built into `/request-password-reset` (H5) with
 *   no configuration needed.
 * - `revokeSessionsOnPasswordReset: true` is the whole of H5's "resetting my
 *   password closes all my old sessions" requirement.
 * - `sendVerificationEmail` / `sendResetPassword` never send mail directly:
 *   they enqueue a `notification_outbox` row (outbox.ts) for the
 *   notifications workstream to actually deliver.
 * - `disabledPaths: ["/update-user"]` — profile edits go exclusively through
 *   this module's own GET/PATCH /me and staff routes (H7), which apply
 *   field-level restrictions, capability guards and audit() that Better
 *   Auth's generic update-user endpoint doesn't know about.
 */
export const auth = betterAuth({
  appName: "hackOS",
  baseURL: config.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: config.BETTER_AUTH_SECRET,
  database: pool,
  trustedOrigins,
  advanced: {
    database: { generateId: "serial" },
    // In production the web app and API live on different origins (and often
    // different sites), so the session cookie must be cross-site: SameSite=None
    // requires Secure, which the HTTPS proxy provides. In dev everything is
    // http://localhost, where None+Secure wouldn't be stored — keep the Lax
    // default there.
    ...(config.isProd
      ? { defaultCookieAttributes: { sameSite: "none" as const, secure: true } }
      : {}),
  },
  disabledPaths: ["/update-user"],
  user: {
    modelName: "users",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    additionalFields: {
      surname: { type: "string", required: true, fieldName: "surname" },
      phone: { type: "string", required: false, fieldName: "phone" },
      language: {
        type: "string",
        required: false,
        defaultValue: "en",
        fieldName: "language",
      },
    },
  },
  session: {
    modelName: "sessions",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  account: {
    modelName: "accounts",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "verifications",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: false,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await enqueueAuthEmail(pool, Number(user.id), "auth.reset", {
        name: user.name,
        resetUrl: url,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Clicking the verification link establishes a session and lands the user
    // logged in — they don't have to sign in again after verifying.
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, token }) => {
      // Point the browser at the web app's /verify-email page after the API
      // verifies the token (shows a real success page, logged in).
      await enqueueAuthEmail(pool, Number(user.id), "auth.verify", {
        name: user.name,
        verifyUrl: withFrontendCallback(token, "/verify-email?verified=1"),
      });
    },
  },
});
