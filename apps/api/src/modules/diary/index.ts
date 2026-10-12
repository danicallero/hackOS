import type { FastifyInstance } from "fastify";
import { registerDiaryRoutes } from "./routes.js";

export async function registerDiaryModule(app: FastifyInstance): Promise<void> {
  registerDiaryRoutes(app);
}
