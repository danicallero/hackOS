import type { FastifyInstance } from "fastify";
import { registerReportRoutes } from "./routes.js";

/** H18: attendee reports of user-generated content and the organiser inbox. */
export function registerReportsModule(app: FastifyInstance): void {
  registerReportRoutes(app);
}
