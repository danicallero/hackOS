import { MAINTENANCE_STATUS_PATH } from "@hackos/shared/maintenance";
import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { getMaintenanceStatus } from "./maintenance.js";
import { register } from "./metrics.js";
import { refreshOperationalMetrics } from "./operational-metrics.js";
import { valkey } from "./valkey.js";

/** Infrastructure probes: liveness, maintenance status, readiness and the Prometheus scrape. */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get(
    "/healthz",
    {
      config: {
        routeAccessPolicy: { kind: "public", anonymousCategory: "health" },
      },
      schema: {
        description: "Process liveness probe. It performs no dependency I/O.",
      },
    },
    async () => ({ status: "ok" }),
  );

  app.get(
    MAINTENANCE_STATUS_PATH,
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "health" } },
      schema: {
        summary: "Maintenance status",
        description:
          "Whether a database restore holds the maintenance lock (#539). Reads the host-written lock file only, performs no database I/O and stays reachable during the restore; clients poll it from their waiting screen.",
      },
    },
    async (_req, reply) => {
      reply.header("cache-control", "no-store");
      return getMaintenanceStatus();
    },
  );

  app.get(
    "/readyz",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "health" } },
      schema: {
        description:
          "Bounded readiness probe. PostgreSQL is required; Valkey is ephemeral and reports a degraded 200 response so its outage does not remove a replica that can still serve durable reads.",
      },
    },
    async (_req, reply) => {
      const [postgres, broker] = await Promise.allSettled([pool.query("SELECT 1"), valkey.ping()]);
      if (postgres.status === "rejected") {
        return reply.code(503).send({
          status: "unavailable",
          postgres: "down",
          valkey: broker.status === "fulfilled" ? "ok" : "down",
        });
      }
      if (broker.status === "rejected") {
        return { status: "degraded", postgres: "ok", valkey: "down" };
      }
      return { status: "ok", postgres: "ok", valkey: "ok" };
    },
  );

  app.get(
    "/metrics",
    {
      config: {
        routeAccessPolicy: { kind: "public", anonymousCategory: "metrics" },
      },
      schema: {
        description:
          "Prometheus scrape endpoint (#540): pg pool saturation/wait, query " +
          "timeouts, #544 priority-lane request rate/admission wait and bounded " +
          "best-effort queue depth, SSE connection counts by lane/topic, " +
          "participant invalidation outcomes, browser refetch observations, " +
          "and Node process defaults.",
      },
    },
    async (_req, reply) => {
      await refreshOperationalMetrics();
      reply.header("content-type", register.contentType);
      return register.metrics();
    },
  );
}
