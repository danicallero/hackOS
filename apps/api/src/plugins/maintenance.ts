import { MAINTENANCE_STATUS_PATH } from "@hackos/shared/maintenance";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { MaintenanceError } from "../lib/errors.js";
import { getMaintenanceStatus } from "../lib/maintenance.js";

/** Stay reachable while the database is being replaced (#539). */
const ALLOWED_PATHS = new Set(["/healthz", "/readyz", "/metrics", MAINTENANCE_STATUS_PATH]);

/**
 * While `deploy/scripts/restore.sh` holds the maintenance lock, every route
 * except probes and the status endpoint answers `503 maintenance_in_progress`
 * so no request reads or writes a half-restored database. Runs before auth
 * context, which would otherwise query the database for the session.
 */
export const maintenancePlugin = fp(async (app: FastifyInstance) => {
  app.addHook("onRequest", async (req, reply) => {
    const requestPath = req.url.split("?", 1)[0] ?? req.url;
    if (req.method === "OPTIONS" || ALLOWED_PATHS.has(requestPath)) return;
    const status = await getMaintenanceStatus();
    if (!status.active) return;
    reply.header("retry-after", "30");
    throw new MaintenanceError({
      phase: status.phase,
      startedAt: status.startedAt,
      etaAt: status.etaAt,
    });
  });
});
