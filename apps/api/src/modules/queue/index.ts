import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { registerEntriesRoutes } from "./entries.routes.js";
import { registerJudgingRoutes } from "./judging.routes.js";
import { registerOperationsRoutes } from "./operations.routes.js";
import { scheduleQueuePump } from "./pump.js";
import { registerReadsRoutes } from "./reads.routes.js";
import { registerRoomsRoutes } from "./rooms.routes.js";

/**
 * WS-B2 — queue & judging core (H29-H42). Routes are split by surface:
 * rooms/admin, state-machine transitions, judging, reads/streams/TV.
 * The pump worker registers at import time (see pump.ts); the repeatable
 * job is scheduled here except under tests, where pumpTick() is exercised
 * directly.
 */
export async function registerQueueModule(app: FastifyInstance): Promise<void> {
  registerRoomsRoutes(app);
  registerEntriesRoutes(app);
  registerJudgingRoutes(app);
  registerOperationsRoutes(app);
  registerReadsRoutes(app);

  if (!config.isTest) {
    await scheduleQueuePump();
  }
}
