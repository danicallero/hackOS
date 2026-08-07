import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import {
  exportApplicationsCsv,
  exportAttendanceCsv,
  exportMealsCsv,
  exportStaffScanStatsCsv,
} from "./csv.js";
import { applicationsCsvQuery } from "./schemas.js";

function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="${filename}"`);
  return reply.send(csv);
}

/** H54: operational CSV exports, gated by exports:run (previously declared but unused). */
export function registerOperationalRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/exports/attendance.csv",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
    },
    async (_req, reply) => {
      return sendCsv(reply, "attendance.csv", await exportAttendanceCsv());
    },
  );

  typed.get(
    "/api/exports/meals.csv",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
    },
    async (_req, reply) => {
      return sendCsv(reply, "meals.csv", await exportMealsCsv());
    },
  );

  typed.get(
    "/api/exports/staff-scan-stats.csv",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
    },
    async (_req, reply) => {
      return sendCsv(reply, "staff-scan-stats.csv", await exportStaffScanStatsCsv());
    },
  );

  typed.get(
    "/api/exports/applications.csv",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: { querystring: applicationsCsvQuery },
    },
    async (req, reply) => {
      return sendCsv(
        reply,
        "applications.csv",
        await exportApplicationsCsv(req.query.applicationId),
      );
    },
  );
}
