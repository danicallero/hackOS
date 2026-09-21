import type { FastifyInstance } from "fastify";
import "./worker.js"; // side-effecting: registers the BullMQ processor at import time
import { registerApplicationBatchExportRoutes } from "./application-batch.routes.js";
import { registerLogisticsExportRoutes } from "./logistics.routes.js";
import { registerOperationalRoutes } from "./operational.routes.js";
import { registerWorkflowRoutes } from "./workflow.routes.js";

/** WS-F: staff export/deletion workflows and operational exports (H54/H56). */
export async function registerExportsModule(app: FastifyInstance): Promise<void> {
  registerWorkflowRoutes(app);
  registerOperationalRoutes(app);
  registerApplicationBatchExportRoutes(app);
  registerLogisticsExportRoutes(app);
}
