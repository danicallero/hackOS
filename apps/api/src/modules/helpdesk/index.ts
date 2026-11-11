import type { FastifyInstance } from "fastify";
import { registerHelpdeskRoutes } from "./routes.js";

/** H61-H67 help desk: helper profiles, knowledge topics, requests and coverage. */
export async function registerHelpdeskModule(app: FastifyInstance): Promise<void> {
  registerHelpdeskRoutes(app);
}
