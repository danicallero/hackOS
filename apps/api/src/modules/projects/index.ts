import type { FastifyInstance } from "fastify";
import { registerProjectLifecycleRoutes } from "./lifecycle.routes.js";
import { registerProjectRoutes } from "./routes.js";

/** WS-B1: projects / Devpost import (H16-H17). No workers needed. */
export async function registerProjectsModule(app: FastifyInstance): Promise<void> {
  registerProjectLifecycleRoutes(app);
  registerProjectRoutes(app);
}
