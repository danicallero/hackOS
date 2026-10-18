import type { FastifyInstance } from "fastify";
import { registerProjectFileRoutes } from "./files.js";
import { registerNativeProjectRoutes } from "./native.routes.js";
import { registerProjectRoutes } from "./routes.js";

/** Native projects (#1005–#1009). */
export async function registerProjectsModule(app: FastifyInstance): Promise<void> {
  registerNativeProjectRoutes(app);
  registerProjectFileRoutes(app);
  registerProjectRoutes(app);
}
