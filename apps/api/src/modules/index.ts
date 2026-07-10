import type { FastifyInstance } from "fastify";
import { registerApplicationsModule } from "./applications/index.js";
import { registerChallengesModule } from "./challenges/index.js";
import { registerEventModule } from "./event/index.js";
import { registerExportsModule } from "./exports/index.js";
import { registerIdentityModule } from "./identity/index.js";
import { registerLogisticsModule } from "./logistics/index.js";
import { registerNotificationsModule } from "./notifications/index.js";
import { registerProjectsModule } from "./projects/index.js";
import { registerQueueModule } from "./queue/index.js";
import { registerSponsorsModule } from "./sponsors/index.js";

/**
 * Module registry. Each domain workstream ships a Fastify plugin under
 * src/modules/<domain>/ exposing `register<Domain>Module(app)` and adds
 * exactly one line here. Keep the list alphabetical to minimize merge
 * conflicts between parallel workstreams.
 */
export async function registerModules(app: FastifyInstance): Promise<void> {
  await registerApplicationsModule(app); // WS-A2 (H11-H15, H27)
  await registerChallengesModule(app); // WS-G  (H44)
  await registerEventModule(app); // WS-G  (H45, H47)
  await registerExportsModule(app); // WS-F  (H54)
  await registerIdentityModule(app); // WS-A1 (H1-H10)
  await registerLogisticsModule(app); // WS-C  (H22-H27)
  await registerNotificationsModule(app); // WS-F  (H50-H53)
  await registerProjectsModule(app); // WS-B1 (H16-H17)
  await registerQueueModule(app); // WS-B2 (H29-H42)
  await registerSponsorsModule(app); // WS-G  (H43-H45)
}
