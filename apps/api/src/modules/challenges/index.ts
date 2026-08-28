import type { FastifyInstance } from "fastify";
import { registerChallengeRoutes } from "./routes.js";
import { scheduleScheduledVisibilityPublisher } from "./visibility-publisher.js";
// Side-effecting import: registers the scheduled visibility processor at import
// time (src/lib/queues.ts convention — "never instantiate BullMQ directly").
import "./visibility-publisher.js";

/**
 * WS-G — sponsor-facing challenge editing and the judging panel builder
 * (H44). Challenges themselves are seeded elsewhere (sponsor onboarding);
 * this module owns editing description/prizes/criteria, the typed judging
 * panel, its preview, its lock after the first submitted evaluation, and
 * per-edit versioning.
 */
export async function registerChallengesModule(app: FastifyInstance): Promise<void> {
  registerChallengeRoutes(app);
  await scheduleScheduledVisibilityPublisher();
}
