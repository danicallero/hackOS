import { createHash } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TooManyRequestsError } from "../../lib/errors.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { setUserIdResolver } from "../../plugins/auth-context.js";
import { auth } from "./auth.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerPermissionGroupRoutes } from "./routes/permissions.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerResendVerificationRoutes } from "./routes/resend-verification.js";
import { registerReviewFixtureRoutes } from "./routes/review-fixtures.js";
import { registerSecondaryEmailRoutes } from "./routes/secondary-email.js";
import { registerUiPrefsRoutes } from "./routes/ui-prefs.js";

/**
 * Identity module (H1-H10). Mounts Better Auth's own handler under
 * /api/auth/* for sign-up/sign-in/sign-out/verify-email/reset-password/
 * get-session/revoke-session(s) (all built-in, see auth.ts for the
 * enumeration-safety and session-revocation notes), then layers this
 * project's own routes for everything Better Auth doesn't cover: rate
 * -limited resend (H3), profile (H7), secondary email (H6), permission
 * groups (H8) and invitations (H9/H10).
 *
 * Also wires `setUserIdResolver` (src/plugins/auth-context.ts) so
 * `req.userId` resolves from the Better Auth session cookie on every
 * request — this is what unblocks every other workstream's
 * `requireCapability` guards.
 */
export async function registerIdentityModule(app: FastifyInstance): Promise<void> {
  setUserIdResolver(async (req) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    return session ? Number(session.user.id) : null;
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
  registerPermissionGroupRoutes(app);
  registerInviteRoutes(app);
  registerUiPrefsRoutes(app);
}

async function betterAuthPassthrough(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
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
