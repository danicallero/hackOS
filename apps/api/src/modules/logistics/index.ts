import type { FastifyInstance } from "fastify";
import { registerIntoleranceRoutes } from "./intolerances.js";
import { registerLogisticsRoutes } from "./routes.js";

/**
 * WS-C — accreditation, presence, meals & activities, logistics stats
 * (H22-H27). Backend contract the offline-first scanner apps sync against:
 * every mutating scan endpoint accepts an Idempotency-Key and is safe to
 * replay; server confirmation is the source of truth.
 */
export async function registerLogisticsModule(app: FastifyInstance): Promise<void> {
  registerLogisticsRoutes(app);
  registerIntoleranceRoutes(app);
}
