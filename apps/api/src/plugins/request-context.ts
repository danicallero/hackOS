import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { runWithRequestContext } from "../lib/request-context.js";
import { classifyRequestLane } from "../lib/request-lanes.js";
import { isProbePath, pathOf } from "../lib/request-path.js";

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
        requestId: randomUUID(),
        getActorId: () => req.userId,
        ip: req.ip,
        userAgent:
          typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        // Provisional lane for the session lookup that runs before admission;
        // the admission hook refines it once the user is known (#1367).
        // Probes are P0 so a saturated checkout gate never fails readiness.
        lane: isProbePath(pathOf(req.url))
          ? "P0"
          : classifyRequestLane({ url: req.url, method: req.method, userId: null }),
      },
      () => done(),
    );
  });
});
