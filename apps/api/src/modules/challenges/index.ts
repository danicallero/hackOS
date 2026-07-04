import type { FastifyInstance } from "fastify";
import { registerChallengeRoutes } from "./routes.js";

/**
 * WS-G — sponsor-facing challenge editing and the judging panel builder
 * (H44). Challenges themselves are seeded elsewhere (sponsor onboarding);
 * this module owns editing description/prizes/criteria, the typed judging
 * panel, its preview, its lock once judging starts, and per-edit versioning.
 */
export async function registerChallengesModule(app: FastifyInstance): Promise<void> {
  registerChallengeRoutes(app);
}
