import type { FastifyInstance } from "fastify";
import { registerStatisticsRoutes } from "./routes.js";

/** H27 generic dashboard scopes, aggregation, panel ACL, and safe exports. */
export async function registerStatisticsModule(app: FastifyInstance): Promise<void> {
  registerStatisticsRoutes(app);
}
