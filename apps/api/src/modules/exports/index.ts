import type { FastifyInstance } from "fastify";
import "./worker.js"; // side-effecting: registers the BullMQ processor at import time
import { registerOperationalRoutes } from "./operational.routes.js";
import { registerWorkflowRoutes } from "./workflow.routes.js";

/** WS-F: staff export/deletion request workflow + operational CSV exports (H54). */
export async function registerExportsModule(app: FastifyInstance): Promise<void> {
  registerWorkflowRoutes(app);
  registerOperationalRoutes(app);
}
