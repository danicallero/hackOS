import type { FastifyInstance } from "fastify";
import { registerApplicationsModule } from "./applications/index.js";
import { registerCertificatesModule } from "./certificates/index.js";
import { registerChallengesModule } from "./challenges/index.js";
import { registerDiaryModule } from "./diary/index.js";
import { registerDirectoryModule } from "./directory/index.js";
import { registerEditionsModule } from "./editions/index.js";
import { registerEventModule } from "./event/index.js";
import { registerExportsModule } from "./exports/index.js";
import { registerFormLibrariesModule } from "./form-libraries/index.js";
import { registerGithubModule } from "./github/index.js";
import { registerHelpdeskModule } from "./helpdesk/index.js";
import { registerIdentityModule } from "./identity/index.js";
import { registerLiveActivitiesModule } from "./live-activities/index.js";
import { registerLogisticsModule } from "./logistics/index.js";
import { registerNotificationsModule } from "./notifications/index.js";
import { registerOnboardingModule } from "./onboarding/index.js";
import { registerProjectsModule } from "./projects/index.js";
import { registerFixtureBoundaryGuard } from "./queue/fixture-boundary.js";
import { registerQueueModule } from "./queue/index.js";
import { registerRealtimeModule } from "./realtime/index.js";
import { registerReportsModule } from "./reports/index.js";
import { registerRsvpsModule } from "./rsvps/index.js";
import { registerSponsorsModule } from "./sponsors/index.js";
import { registerStatisticsModule } from "./statistics/index.js";
import { registerTelemetryModule } from "./telemetry/index.js";

/**
 * Module registry. Each domain workstream ships a Fastify plugin under
 * src/modules/<domain>/ exposing `register<Domain>Module(app)` and adds
 * exactly one line here. Keep the list alphabetical to minimize merge
 * conflicts between parallel workstreams.
 */
export async function registerModules(app: FastifyInstance): Promise<void> {
  // Registered first so it covers every module's routes (H18, H54).
  registerFixtureBoundaryGuard(app);
  await registerApplicationsModule(app); // WS-A2 (H11-H15, H27)
  registerCertificatesModule(app); // #1083 attendance certificates
  await registerChallengesModule(app); // WS-G  (H44)
  await registerDiaryModule(app); // #935 event diary (people and sponsor stands)
  await registerDirectoryModule(app); // #934 opt-in people directory
  await registerEditionsModule(app); // multi-edition lifecycle (H8, H53)
  await registerEventModule(app); // WS-G  (H45, H47)
  await registerExportsModule(app); // WS-F  (H54, H56)
  registerFormLibrariesModule(app);
  await registerGithubModule(app); // GitHub App repo linking and activity ranking
  await registerHelpdeskModule(app); // H61-H67 help desk
  await registerIdentityModule(app); // WS-A1 (H1-H10)
  await registerLiveActivitiesModule(app); // #966 Live Activities (H38, H25, H26)
  await registerLogisticsModule(app); // WS-C  (H22-H27)
  await registerNotificationsModule(app);
  registerOnboardingModule(app); // WS-F  (H50-H53)
  await registerProjectsModule(app); // WS-B1 (H16-H17)
  await registerQueueModule(app); // WS-B2 (H29-H42)
  registerRealtimeModule(app); // #892 multiplexed realtime stream
  registerReportsModule(app); // H18 content reports
  registerRsvpsModule(app); // per-activity RSVPs (catering, #933 generalised)
  await registerSponsorsModule(app); // WS-G  (H43-H45)
  await registerStatisticsModule(app); // H27 generic statistics dashboard
  registerTelemetryModule(app); // H38, H41-H42, #544 browser observations
}
