import type { FastifyInstance } from "fastify";
import { registerLiveActivityRoutes } from "./routes.js";
import { scheduleLiveActivitiesWorker } from "./worker.js";

/**
 * Live Activities / Live Updates (#966; H38 queue, H25/H26 staff
 * activities): device/session registry, the shared state builders
 * (state.ts), the APNs and Android senders and the push worker. See
 * docs/live-activities.md.
 */
export async function registerLiveActivitiesModule(app: FastifyInstance): Promise<void> {
  registerLiveActivityRoutes(app);
  await scheduleLiveActivitiesWorker();
}
