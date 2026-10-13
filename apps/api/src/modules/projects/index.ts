import type { FastifyInstance } from "fastify";
import { registerProjectLifecycleRoutes } from "./lifecycle.routes.js";
import { registerProjectRoutes } from "./routes.js";

/** Projects: one entity from draft to submission (H19-H21, #1006). No workers needed. */
export async function registerProjectsModule(app: FastifyInstance): Promise<void> {
  registerProjectLifecycleRoutes(app);
  registerProjectRoutes(app);
}
