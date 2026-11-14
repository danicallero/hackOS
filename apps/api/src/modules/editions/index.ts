import type { FastifyInstance } from "fastify";
import { registerEditionRoutes } from "./routes.js";

/** Multi-edition lifecycle and the caller's edition list (docs/multi-edition-plan.md). */
export async function registerEditionsModule(app: FastifyInstance): Promise<void> {
  registerEditionRoutes(app);
}
