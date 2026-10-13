import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";
import { UpgradeRequiredError } from "../lib/errors.js";
import { observeMobileClient } from "../lib/metrics.js";

/** Sent by the mobile app on every request: the native build number (#999). */
export const BUILD_HEADER = "x-hackos-build";

/**
 * The installed mobile build behind a request, or null when it does not come
 * from the app. Web and tooling never send the header. Builds that predate it
 * still carry Better Auth's `expo-origin` header, so they count as build 0
 * and fall below any configured floor.
 */
export function mobileBuildOf(req: FastifyRequest): number | null {
  const raw = req.headers[BUILD_HEADER];
  if (typeof raw === "string" && /^\d{1,7}$/.test(raw.trim())) return Number(raw);
  return req.headers["expo-origin"] !== undefined || raw !== undefined ? 0 : null;
}

/**
 * Reject mobile builds below `MOBILE_MIN_BUILD` with `426 upgrade_required`
 * so the app can show its blocking update screen (#999). Runs before any
 * route work; probes and metrics stay reachable.
 */
export const clientFloorPlugin = fp(async (app: FastifyInstance) => {
  app.addHook("onRequest", async (req) => {
    const build = mobileBuildOf(req);
    if (build === null) return;
    const requestPath = req.url.split("?", 1)[0] ?? req.url;
    if (requestPath === "/healthz" || requestPath === "/readyz" || requestPath === "/metrics") {
      return;
    }
    const minBuild = config.MOBILE_MIN_BUILD;
    const reported = typeof req.headers[BUILD_HEADER] === "string" && build > 0;
    const label = reported ? String(build) : "unreported";
    if (build < minBuild) {
      observeMobileClient(label, "rejected");
      throw new UpgradeRequiredError({ minBuild, build });
    }
    observeMobileClient(label, "allowed");
  });
});
