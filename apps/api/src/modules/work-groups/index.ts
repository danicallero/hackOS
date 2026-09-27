import type { FastifyInstance } from "fastify";
import { registerWorkGroupsRoutes } from "./routes.js";
export async function registerWorkGroupsModule(app: FastifyInstance): Promise<void> {
  registerWorkGroupsRoutes(app);
}
