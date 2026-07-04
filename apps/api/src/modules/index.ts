import type { FastifyInstance } from "fastify";
import { registerIdentityModule } from "./identity/index.js";
import { registerProjectsModule } from "./projects/index.js";

/**
 * Module registry. Each domain workstream ships a Fastify plugin under
 * src/modules/<domain>/ exposing `register<Domain>Module(app)` and adds
 * exactly one line here. Keep the list alphabetical to minimize merge
 * conflicts between parallel workstreams.
 */
export async function registerModules(app: FastifyInstance): Promise<void> {
  // await registerApplicationsModule(app);   // WS-A2 (H11-H15)
  await registerIdentityModule(app); // WS-A1 (H1-H10)
  // await registerNotificationsModule(app);  // WS-F  (H50-H53)
  await registerProjectsModule(app); // WS-B1 (H16-H17)
  // await registerQueueModule(app);          // WS-B2 (H29-H42)
}
