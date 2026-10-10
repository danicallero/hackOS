import type { FastifyInstance } from "fastify";
import { registerDirectoryRoutes } from "./routes.js";

export async function registerDirectoryModule(app: FastifyInstance): Promise<void> {
  registerDirectoryRoutes(app);
}
