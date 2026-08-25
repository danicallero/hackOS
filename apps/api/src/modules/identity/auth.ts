import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { enqueueAuthEmail } from "./outbox.js";
import { valkeyRateLimitStorage } from "./rate-limit-storage.js";

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
  // The Expo mobile app has no real browser origin; the expo() plugin below
  // stamps this custom scheme on the Origin header of its requests instead.
  `${config.MOBILE_APP_SCHEME}://`,
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
 * Same-origin guard (H188) for the `next` destination a client asked to be
 * returned to after verification. Only a relative path is accepted — never
 * an absolute URL or a protocol-relative `//host`, which browsers resolve as
 * absolute and would let a crafted sign-up/resend request redirect a user
 * off-site after they click the emailed link.
 */
function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * Better Auth bakes the caller's requested `callbackURL` (sign-up/resend's
 * `body.callbackURL` — the web app's own `/verify-email?verified=1&next=...`
 * path) into the `url` it hands `sendVerificationEmail`, itself pointed at
 * the API's own verify endpoint, e.g.
 * `${baseURL}/verify-email?token=...&callbackURL=<encoded>`. We ignore that
 * `url` and build our own via `withFrontendCallback`, so to carry the
 * caller's intended frontend destination through we pull it back out here.
 */
function frontendPathFromBetterAuthUrl(url: string): string | undefined {
  const callbackURL = new URL(url).searchParams.get("callbackURL");
  if (!callbackURL || callbackURL === "/" || !isSafeReturnPath(callbackURL)) return undefined;
  return callbackURL;
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
 *   sign-up/verification time (surname, language); shirt size, food
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
 * - `plugins: [expo()]` (H4, H55) is the official Better Auth integration for
 *   the mobile app (`apps/mobile`): it overrides the Origin header on Expo's
 *   requests to `MOBILE_APP_SCHEME://` (see trustedOrigins above) and adds the
 *   `/expo-authorization-proxy` endpoint the client's `expoClient()` plugin
 *   needs for its deep-link auth redirect. Session storage on-device is
 *   `expo-secure-store`, driven entirely by the client plugin — nothing else
 *   changes here.
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
    // Better Auth's rate limiter (below) keys on client IP read from this
    // header. `betterAuthPassthrough` (index.ts) always overwrites it with
    // Fastify's own `request.ip` — already resolved correctly per
    // `config.trustProxy` — before forwarding the request here, so pinning
    // to exactly this one header (instead of the library's wider
    // multi-header default) means we're the sole source of truth for it;
    // an untrusted client can't spoof its way past the limiter (#538).
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  // #538: distributed (Valkey-backed) rate limiting for every /api/auth/*
  // path. Limits are deliberately more generous than Better Auth's built-in
  // defaults (3/10s for sign-in/sign-up) because hackathon venues commonly
  // put many legitimate attendees behind one NAT'd IP — see
  // docs/rate-limiting.md for the full rationale and the coarseness caveat
  // that comes with per-IP throttling in that setting.
  rateLimit: {
    enabled: true,
    customStorage: valkeyRateLimitStorage,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 300, max: 30 },
      "/sign-up/email": { window: 3600, max: 30 },
      "/request-password-reset": { window: 3600, max: 10 },
      "/reset-password": { window: 900, max: 20 },
      "/verify-email": { window: 3600, max: 30 },
    },
  },
  disabledPaths: ["/update-user"],
  plugins: [expo()],
  user: {
    modelName: "users",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    additionalFields: {
      surname: { type: "string", required: true, fieldName: "surname" },
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
    sendVerificationEmail: async ({ user, token, url }) => {
      // Point the browser at the web app's /verify-email page after the API
      // verifies the token (shows a real success page, logged in). If the
      // caller (sign-up or resend-verification) asked to be returned to a
      // specific same-origin destination, honor it (H188).
      const frontendPath = frontendPathFromBetterAuthUrl(url) ?? "/verify-email?verified=1";
      await enqueueAuthEmail(pool, Number(user.id), "auth.verify", {
        name: user.name,
        verifyUrl: withFrontendCallback(token, frontendPath),
      });
    },
  },
});
