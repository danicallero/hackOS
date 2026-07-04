import type { FastifyInstance } from "fastify";
import { registerProjectRoutes } from "./routes.js";

/** WS-B1: projects / Devpost import (H16-H17). No workers needed. */
export async function registerProjectsModule(app: FastifyInstance): Promise<void> {
  registerProjectRoutes(app);
}
