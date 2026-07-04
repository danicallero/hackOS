import type { FastifyInstance } from "fastify";
import { registerSponsorRoutes } from "./routes.js";

/**
 * WS-G — sponsor (enterprise) management and public reveal (H43-H45): profile
 * with logo object storage and display priority, an on/off + scheduled
 * visibility window, and the anonymous public logo grid.
 */
export async function registerSponsorsModule(app: FastifyInstance): Promise<void> {
  registerSponsorRoutes(app);
}
