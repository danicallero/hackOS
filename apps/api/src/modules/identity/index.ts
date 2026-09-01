import { createHash } from "node:crypto";
import { verifyJWT } from "better-auth/crypto";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { ForbiddenError, TooManyRequestsError } from "../../lib/errors.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { setUserIdResolver } from "../../plugins/auth-context.js";
import { auth, getBetterAuthSessionToken } from "./auth.js";
import { recordReviewFixtureAuthentication } from "./review-fixture-usage.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerResendVerificationRoutes } from "./routes/resend-verification.js";
import { registerReviewFixtureRoutes } from "./routes/review-fixtures.js";
import { registerRoleGrantRuleRoutes } from "./routes/role-grant-rules.js";
import { registerRoleRoutes } from "./routes/roles.js";
import { registerSecondaryEmailRoutes } from "./routes/secondary-email.js";
import { registerUiPrefsRoutes } from "./routes/ui-prefs.js";

/**
 * Identity module (H1-H10). Mounts Better Auth's own handler under
 * /api/auth/* for sign-up/sign-in/sign-out/verify-email/reset-password/
 * get-session/revoke-session(s) (all built-in, see auth.ts for the
 * enumeration-safety and session-revocation notes), then layers this
 * project's own routes for everything Better Auth doesn't cover: rate
 * -limited resend (H3), profile (H7), secondary email (H6), hierarchical
 * roles (H8) and invitations (H9/H10).
 *
 * Also wires `setUserIdResolver` (src/plugins/auth-context.ts) so
 * `req.userId` resolves from the Better Auth session cookie on every
 * request — this is what unblocks every other workstream's
 * `requireCapability` guards.
 */
export async function registerIdentityModule(app: FastifyInstance): Promise<void> {
  setUserIdResolver(async (req) => {
    // Authentication is a read here. Better Auth's normal session lookup may
    // refresh a near-expiry session back to the configured seven-day lifetime,
    // which would move an H54 pending-exit deadline while the request is being
    // authorized. Read the authoritative database row without refresh/cache.
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableRefresh: true, disableCookieCache: true },
    });
    // Keep the verified credential on the request so lifecycle operations can
    // bind deadlines to the exact session that authenticated this request.
    // The token is never logged or persisted by the auth context.
    req.sessionToken = session?.session.token ?? null;
    return session ? Number(session.user.id) : null;
  });

  // H54: account_state is a lifecycle boundary, not just a capability input.
  // Keep the recovery surface explicit at the identity-module boundary so a
  // pending account cannot reach another identity route that happens to use a
  // weaker authenticated guard. Better Auth's generated catch-all is checked
  // again in betterAuthPassthrough because its public, email-targeted routes
  // can be reached without an authenticated session.
  app.addHook("preHandler", async (request) => {
    const path = request.url.split("?", 1)[0] ?? "";
    // The Better Auth catch-all is checked by its own handler below. Keep
    // identity-owned auth routes (notably resend-verification) behind this
    // same pending-account gate instead of treating every /api/auth/* path as
    // generated and therefore exempt.
    if (
      path.startsWith("/api/auth/") &&
      request.routeOptions.config?.routeAccessPolicyExemption === "better-auth-generated"
    )
      return;

    const pending = await pendingAccountForRequest(request);
    const target =
      path === "/api/auth/resend-verification"
        ? await pendingAccountByEmail(emailFromAuthBody(request.body))
        : null;
    if (!pending && !target) return;
    if (isPendingRecoveryRoute(request.method, path)) return;

    throw pendingAccountBlockedError();
  });

  // Better Auth's own handler, mounted as a raw pass-through. It needs the
  // ORIGINAL request body bytes (it parses JSON itself via the Fetch API's
  // `Request`), so this sub-context overrides content-type parsing to hand
  // back an untouched buffer instead of Fastify's normal parsed-JSON body.
  // Scoping it inside `app.register(async (scoped) => ...)` keeps that
  // override local to these routes — every other module registered on the
  // shared `app` keeps Fastify's default JSON parsing untouched.
  await app.register(async (scoped) => {
    const passthroughParser = (
      _req: FastifyRequest,
      body: Buffer,
      done: (err: Error | null, body?: unknown) => void,
    ) => done(null, body);
    scoped.addContentTypeParser("application/json", { parseAs: "buffer" }, passthroughParser);
    scoped.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "buffer" },
      passthroughParser,
    );
    scoped.addContentTypeParser("*", { parseAs: "buffer" }, passthroughParser);

    scoped.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      url: "/api/auth/*",
      config: { routeAccessPolicyExemption: "better-auth-generated" },
      handler: betterAuthPassthrough,
    });
  });

  registerResendVerificationRoutes(app);
  registerProfileRoutes(app);
  registerReviewFixtureRoutes(app);
  registerSecondaryEmailRoutes(app);
  registerRoleRoutes(app);
  registerRoleGrantRuleRoutes(app);
  registerInviteRoutes(app);
  registerUiPrefsRoutes(app);
}

async function betterAuthPassthrough(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  await enforcePendingBetterAuthRoute(request);

  // #559: one attacked account must not consume the shared venue IP's whole
  // sign-in budget. Apply a stricter distributed counter to the normalized
  // account identifier before Better Auth applies its generous IP ceiling.
  // Hashing keeps email addresses out of Valkey keys and operational tooling.
  if (request.method === "POST" && request.url.split("?", 1)[0] === "/api/auth/sign-in/email") {
    const email = signInEmail(request.body);
    if (email) {
      const accountKey = createHash("sha256").update(email).digest("hex");
      const accountLimit = await consumeRateLimit("auth-sign-in-account", accountKey, {
        windowSeconds: 300,
        max: 10,
      });
      if (!accountLimit.allowed) {
        throw new TooManyRequestsError(
          "Too many requests — try again later.",
          accountLimit.retryAfterSeconds,
        );
      }
    }
  }

  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url, `http://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  // #538: overwrite whatever x-forwarded-for the client sent with Fastify's
  // own trust-aware resolution (`request.ip`, honoring `config.trustProxy`)
  // so Better Auth's rate limiter (auth.ts) can't be spoofed by a client
  // forging that header when the API isn't actually behind a proxy.
  headers.set("x-forwarded-for", request.ip);

  const init: RequestInit = { method: request.method, headers };
  const hasBody = !["GET", "HEAD"].includes(request.method) && Buffer.isBuffer(request.body);
  if (hasBody) init.body = new Uint8Array(request.body as Buffer);

  const webRequest = new Request(url, init);
  const response = await auth.handler(webRequest);

  // Keep a non-sensitive operational signal for the admin fixture dashboard.
  // This records only successful sign-ins for the current synthetic account;
  // a telemetry failure must never turn a successful login into a 500.
  if (request.method === "POST" && request.url.split("?", 1)[0] === "/api/auth/sign-in/email") {
    const email = signInEmail(request.body);
    if (email && response.ok) {
      await recordReviewFixtureAuthentication(pool, email).catch(() => undefined);
    }
  }

  reply.status(response.status);
  response.headers.forEach((value, key) => {
    // Fastify sets its own; letting Better Auth's through as-is is fine for
    // everything else (set-cookie, content-type, etc.)
    if (key.toLowerCase() === "content-length") return;
    reply.header(key, value);
    // #538: Better Auth's own rate-limiter (auth.ts's `rateLimit` option)
    // rejects with its own `X-Retry-After` header, bypassing our error
    // handler's `retry-after` (app.ts) entirely — normalize it to the same
    // header every other rate limit in this app uses (and the one CORS
    // actually exposes cross-origin, see app.ts's `exposedHeaders`), so
    // clients handle 429s from any endpoint the same way.
    if (key.toLowerCase() === "x-retry-after") reply.header("retry-after", value);
  });

  const buf = Buffer.from(await response.arrayBuffer());
  // Return the reply (a thenable that resolves at end-of-stream): with async
  // onSend hooks in the app, `reply.sent` stays false until the raw response
  // ends, and a handler that resolves `undefined` before that makes Fastify
  // fire a second send (ERR_HTTP_HEADERS_SENT as an unhandled rejection).
  return reply.send(buf.length > 0 ? buf : null);
}

function signInEmail(body: unknown): string | null {
  if (!Buffer.isBuffer(body)) return null;
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("email" in parsed)) return null;
    const email = (parsed as { email?: unknown }).email;
    return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
  } catch {
    // Better Auth owns malformed-body validation and its public error shape.
    return null;
  }
}

function emailFromAuthBody(body: unknown): string | null {
  const parsed =
    authBody(body) ??
    (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null);
  if (!parsed) return signInEmail(body);
  const email = parsed.email;
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

type PendingIdentity = { id: number; email: string };

const PENDING_AUTH_SESSION_PATHS = new Set(["/api/auth/get-session", "/api/auth/sign-out"]);

const PENDING_EMAIL_TARGET_PATHS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-up/email",
  "/api/auth/request-password-reset",
  "/api/auth/send-verification-email",
]);

function pendingAccountBlockedError(): ForbiddenError {
  return new ForbiddenError(
    "This account is being removed; only recovery, status, cancellation, and sign-out are available.",
    { code: "account_removal_pending" },
  );
}

function isPendingRecoveryRoute(method: string, path: string): boolean {
  return (
    (method === "GET" && (path === "/api/me" || path === "/api/me/removal-status")) ||
    (method === "POST" && path === "/api/me/anonymize/cancel")
  );
}

/** Convert Fastify's Node header map into the Fetch Headers Better Auth uses. */
function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return headers;
}

async function pendingAccountForRequest(
  request: FastifyRequest,
  includeSignedCookie = false,
): Promise<PendingIdentity | null> {
  const userIds = new Set<number>();
  if (request.userId != null && Number.isInteger(request.userId)) userIds.add(request.userId);

  if (includeSignedCookie) {
    const sessionToken = await getBetterAuthSessionToken(requestHeaders(request));
    if (sessionToken) {
      const { rows } = await pool.query<{ user_id: number }>(
        `SELECT user_id
           FROM sessions
          WHERE token = $1 AND expires_at > clock_timestamp()`,
        [sessionToken],
      );
      if (rows[0]) userIds.add(rows[0].user_id);
    }
  }

  if (userIds.size === 0) return null;
  const { rows } = await pool.query<PendingIdentity>(
    `SELECT id, email
       FROM users
      WHERE id = ANY($1::int[])
        AND account_state = 'removal_pending'
        AND anonymized_at IS NULL
      ORDER BY id
      LIMIT 1`,
    [[...userIds]],
  );
  return rows[0] ?? null;
}

async function pendingAccountByEmail(email: string | null): Promise<PendingIdentity | null> {
  if (!email) return null;
  const { rows } = await pool.query<PendingIdentity>(
    `SELECT id, email
       FROM users
      WHERE lower(email) = $1
        AND account_state = 'removal_pending'
        AND anonymized_at IS NULL
      LIMIT 1`,
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

function authBody(body: unknown): Record<string, unknown> | null {
  if (!Buffer.isBuffer(body)) return null;
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function pendingAccountByResetToken(token: string | null): Promise<PendingIdentity | null> {
  if (!token) return null;
  const { rows } = await pool.query<PendingIdentity>(
    `SELECT u.id, u.email
       FROM verifications v
       JOIN users u ON u.id::text = v.value
      WHERE v.identifier = $1
        AND v.expires_at > clock_timestamp()
        AND u.account_state = 'removal_pending'
        AND u.anonymized_at IS NULL
      LIMIT 1`,
    [`reset-password:${token}`],
  );
  return rows[0] ?? null;
}

async function pendingAccountByVerificationToken(
  token: string | null,
): Promise<PendingIdentity | null> {
  if (!token) return null;
  try {
    const payload = await verifyJWT<{ email?: unknown }>(token, config.BETTER_AUTH_SECRET);
    if (!payload || typeof payload.email !== "string") return null;
    return pendingAccountByEmail(payload.email);
  } catch {
    return null;
  }
}

async function pendingAuthTarget(
  request: FastifyRequest,
  path: string,
): Promise<PendingIdentity | null> {
  if (PENDING_EMAIL_TARGET_PATHS.has(path)) {
    return pendingAccountByEmail(emailFromAuthBody(request.body));
  }

  const body = authBody(request.body);
  if (path === "/api/auth/reset-password") {
    const token = typeof body?.token === "string" ? body.token : null;
    return pendingAccountByResetToken(token);
  }

  if (path.startsWith("/api/auth/reset-password/")) {
    return pendingAccountByResetToken(path.slice("/api/auth/reset-password/".length));
  }

  if (path === "/api/auth/verify-email") {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    return pendingAccountByVerificationToken(url.searchParams.get("token"));
  }

  return null;
}

async function enforcePendingBetterAuthRoute(request: FastifyRequest): Promise<void> {
  const path = request.url.split("?", 1)[0] ?? "";
  const current = await pendingAccountForRequest(request, true);
  const target = await pendingAuthTarget(request, path);

  // No pending account is involved. This preserves Better Auth's public
  // enumeration-safe sign-up/reset flows for ordinary active/anonymous users.
  if (!current && !target) return;

  if (PENDING_AUTH_SESSION_PATHS.has(path)) {
    // A public sign-out/get-session request has no pending identity to protect;
    // a pending session may use both documented session lifecycle operations.
    return;
  }

  // Signing in to the pending account is the recovery entry point used after
  // a browser/device loses its original session. Never let a pending session
  // use that same route to switch into a different active account.
  if (path === "/api/auth/sign-in/email" && target && (!current || target.id === current.id)) {
    return;
  }

  throw pendingAccountBlockedError();
}
