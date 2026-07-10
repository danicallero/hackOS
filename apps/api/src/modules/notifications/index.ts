import type { FastifyInstance } from "fastify";
import { scheduleAnnouncementsPublisher } from "./announcements-publisher.js";
// Side-effecting imports: each registers its BullMQ processor at import time
// (src/lib/queues.ts convention — "never instantiate BullMQ directly").
import "./dispatcher.js";
import "./announcements-publisher.js";
import "./schedule-reminders.js";
import { scheduleOutboxDispatcher } from "./dispatcher.js";
import { registerAnnouncementRoutes } from "./routes/announcements.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerInboxRoutes } from "./routes/inbox.js";
import { registerPreferenceRoutes } from "./routes/preferences.js";
import { scheduleActivityReminders } from "./schedule-reminders.js";

/**
 * WS-F: notifications, announcements, audit surface (H50-H53). See
 * dispatcher.ts, announcements-publisher.ts and schedule-reminders.ts (H51,
 * issue #80) for the background jobs; service.ts's `notify()` is the
 * contract other modules import to enqueue notifications (raw INSERT into
 * notification_outbox also works, siblings already do that in a few places).
 */
export async function registerNotificationsModule(app: FastifyInstance): Promise<void> {
  registerPreferenceRoutes(app);
  registerInboxRoutes(app);
  registerAnnouncementRoutes(app);
  registerAuditRoutes(app);

  await scheduleOutboxDispatcher();
  await scheduleAnnouncementsPublisher();
  await scheduleActivityReminders();
}
