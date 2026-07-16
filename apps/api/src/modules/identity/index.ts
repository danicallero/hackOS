import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { setUserIdResolver } from "../../plugins/auth-context.js";
import { auth } from "./auth.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerPermissionGroupRoutes } from "./routes/permissions.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerResendVerificationRoutes } from "./routes/resend-verification.js";
import { registerSecondaryEmailRoutes } from "./routes/secondary-email.js";

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
      handler: betterAuthPassthrough,
    });
  });

  registerResendVerificationRoutes(app);
  registerProfileRoutes(app);
  registerSecondaryEmailRoutes(app);
  registerPermissionGroupRoutes(app);
  registerInviteRoutes(app);
}

async function betterAuthPassthrough(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url, `http://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }

  const init: RequestInit = { method: request.method, headers };
  const hasBody = !["GET", "HEAD"].includes(request.method) && Buffer.isBuffer(request.body);
  if (hasBody) init.body = request.body as Buffer;

  const webRequest = new Request(url, init);
  const response = await auth.handler(webRequest);

  reply.status(response.status);
  response.headers.forEach((value, key) => {
    // Fastify sets its own; letting Better Auth's through as-is is fine for
    // everything else (set-cookie, content-type, etc.)
    if (key.toLowerCase() === "content-length") return;
    reply.header(key, value);
  });

  const buf = Buffer.from(await response.arrayBuffer());
  // Return the reply (a thenable that resolves at end-of-stream): with async
  // onSend hooks in the app, `reply.sent` stays false until the raw response
  // ends, and a handler that resolves `undefined` before that makes Fastify
  // fire a second send (ERR_HTTP_HEADERS_SENT as an unhandled rejection).
  return reply.send(buf.length > 0 ? buf : null);
}
