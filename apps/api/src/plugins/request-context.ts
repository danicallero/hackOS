import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { runWithRequestContext } from "../lib/request-context.js";

/**
 * Opens an AsyncLocalStorage context for the request's IP/user-agent, so
 * `audit()` (src/lib/audit.ts, H53) can fill those fields for every call
 * site automatically instead of each of the ~35 sensitive-mutation routes
 * threading `req` through to pass them explicitly.
 */
export const requestContextPlugin = fp(async (app: FastifyInstance) => {
  app.addHook("onRequest", (req, _reply, done) => {
    runWithRequestContext(
      {
        ip: req.ip,
        userAgent:
          typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      },
      () => done(),
    );
  });
});
