import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import {
  exportApplicationsCsv,
  exportAttendanceCsv,
  exportMealsCsv,
  exportStaffScanStatsCsv,
} from "./csv.js";
import { applicationsCsvQuery } from "./schemas.js";

/** H54: operational CSV exports, gated by exports:run (previously declared but unused). */
export function registerOperationalRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/exports/attendance.csv",
    { preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN) },
    async (_req, reply) => {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="attendance.csv"`);
      return exportAttendanceCsv();
    },
  );

  typed.get(
    "/api/exports/meals.csv",
    { preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN) },
    async (_req, reply) => {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="meals.csv"`);
      return exportMealsCsv();
    },
  );

  typed.get(
    "/api/exports/staff-scan-stats.csv",
    { preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN) },
    async (_req, reply) => {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="staff-scan-stats.csv"`);
      return exportStaffScanStatsCsv();
    },
  );

  typed.get(
    "/api/exports/applications.csv",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      schema: { querystring: applicationsCsvQuery },
    },
    async (req, reply) => {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="applications.csv"`);
      return exportApplicationsCsv(req.query.applicationId);
    },
  );
}
