import type { FastifyInstance } from "fastify";
import { registerRealtimeRoutes } from "./routes.js";

export function registerRealtimeModule(app: FastifyInstance): void {
  registerRealtimeRoutes(app);
}
