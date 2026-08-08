import type { FastifyInstance } from "fastify";
// Side-effecting import: registers the expirer BullMQ processor at import time
// (src/lib/queues.ts convention — "never instantiate BullMQ directly").
import "./expirer.js";
import { registerAdminRoutes } from "./admin.routes.js";
import { registerConfirmRoutes } from "./confirm.routes.js";
import { scheduleExpirer } from "./expirer.js";
import { registerFilesExportRoutes } from "./files-export.routes.js";
import { registerMeRoutes } from "./me.routes.js";
import { registerReviewRoutes } from "./review.routes.js";
import { registerStatsRoutes } from "./stats.routes.js";
import { registerUploadRoutes } from "./upload.routes.js";

/**
 * WS-A2: inscripción / applications (H11-H15, H27, H56). Routes plus the spot
 * confirmation expirer (plan/07 §5.2). The application state machine
 * (draft -> submitted -> review -> accepted|rejected; accepted -> confirmed|
 * declined|expired) lives in service.ts.
 */
export async function registerApplicationsModule(app: FastifyInstance): Promise<void> {
  registerAdminRoutes(app);
  registerMeRoutes(app);
  registerReviewRoutes(app);
  registerConfirmRoutes(app);
  registerUploadRoutes(app);
  registerFilesExportRoutes(app);
  registerStatsRoutes(app);

  await scheduleExpirer();
}
