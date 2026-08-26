import type { FastifyInstance } from "fastify";
import { registerIntoleranceRoutes } from "./intolerances.js";
import { registerLogisticsRoutes } from "./routes.js";
// Side-effecting imports: register the BullMQ processors at import time
// (src/lib/queues.ts convention — "never instantiate BullMQ directly").
import "./presence-closer.js";
import { schedulePresenceEventEndCloser } from "./presence-closer.js";
import "./schedule-publisher.js";
import { scheduleScannerTombstoneCleanup } from "./scanner-sync.js";
import { scheduleSchedulePublisher } from "./schedule-publisher.js";
import { registerUniversityRoutes } from "./universities.js";

/**
 * WS-C — accreditation, presence, meals & activities, logistics stats
 * (H22-H27). Backend contract the offline-first scanner apps sync against:
 * every mutating scan endpoint accepts an Idempotency-Key and is safe to
 * replay; server confirmation is the source of truth. See
 * schedule-publisher.ts for the scheduled-visibility background job (H47/H48).
 */
export async function registerLogisticsModule(app: FastifyInstance): Promise<void> {
  registerLogisticsRoutes(app);
  registerIntoleranceRoutes(app);
  registerUniversityRoutes(app);

  await scheduleSchedulePublisher();
  await schedulePresenceEventEndCloser();
  await scheduleScannerTombstoneCleanup();
}
