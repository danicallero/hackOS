import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { sendCsv } from "../../lib/csv.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import {
  exportApplicationsCsv,
  exportAttendanceCsv,
  exportMealsCsv,
  exportStaffScanStatsCsv,
} from "./csv.js";
import { exportProjectsCsv } from "./projects.js";
import { applicationsCsvQuery } from "./schemas.js";

/** H54: operational CSV exports, gated by exports:run (previously declared but unused). */
export function registerOperationalRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/exports/projects.csv",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: {
        summary: "Export project submissions",
        description:
          "Organizer-only CSV of real projects with one column per configured form question, challenge selections, judging status and separate name/email columns for each active team member. Includes drafts; submitted answers and question definitions use the last immutable snapshot. Retains historical question columns. Excludes fixture accounts, private judging notes and unpublished winners (H16/H54).",
      },
    },
    async (req, reply) => sendCsv(reply, "projects.csv", await exportProjectsCsv(req.userId!)),
  );

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
