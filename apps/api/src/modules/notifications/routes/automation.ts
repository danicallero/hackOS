import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  SCHEDULE_REMINDER_LEAD_MINUTES_MAX,
  SCHEDULE_REMINDER_LEAD_MINUTES_MIN,
} from "@hackos/shared/notification-automation";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireCapability } from "../../../lib/capabilities.js";
import { idempotencyGuard } from "../../../lib/idempotency.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import {
  readNotificationAutomationSettings,
  requestScheduleRemindersRun,
  saveNotificationAutomationSettings,
} from "../automation-settings.js";

const automationSettingsSchema = z.object({
  scheduleRemindersEnabled: z.boolean(),
  scheduleReminderLeadMinutes: z.number().int(),
  defaultScheduleReminderLeadMinutes: z.number().int(),
  scheduleReminderLeadCustom: z.boolean(),
});

const putAutomationSettingsBody = z
  .object({
    scheduleRemindersEnabled: z.boolean().optional(),
    scheduleReminderLeadMinutes: z
      .number()
      .int()
      .min(SCHEDULE_REMINDER_LEAD_MINUTES_MIN)
      .max(SCHEDULE_REMINDER_LEAD_MINUTES_MAX)
      .nullable()
      .optional(),
  })
  .strict();

/** Organizer settings of the automatic notification jobs (H45, H51, H52, H53). */
export function registerAutomationRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  // Same capability as the Live Activity timings: event-wide automation lives
  // with event identity and timing.
  const access = routeAccess({ kind: "capability", capability: CAPABILITIES.EVENT_MANAGE });

  api.get(
    "/api/notifications/automation",
    {
      ...access,
      preHandler: requireCapability(CAPABILITIES.EVENT_MANAGE),
      schema: {
        summary: "Automatic notification settings",
        description:
          "Event-level switch and timing of the automatic schedule-item reminder (H51). " +
          "`scheduleRemindersEnabled` turns the job off for everyone (users' own opt-ins are " +
          "untouched); `scheduleReminderLeadMinutes` is how long before an item starts its " +
          "reminder is sent: the organizer override when `scheduleReminderLeadCustom`, else " +
          "`defaultScheduleReminderLeadMinutes`.",
        response: { 200: automationSettingsSchema },
      },
    },
    async () => readNotificationAutomationSettings(),
  );

  api.put(
    "/api/notifications/automation",
    {
      ...access,
      preHandler: [requireCapability(CAPABILITIES.EVENT_MANAGE), idempotencyGuard],
      schema: {
        summary: "Save automatic notification settings",
        description:
          "Omitted fields keep their value. `scheduleReminderLeadMinutes` is 1–1440; `null` or " +
          "the default itself clears the override. Audited; the reminder job runs shortly after " +
          "the save, so the change applies within seconds. Reminders already sent are not " +
          "repeated when the lead grows.",
        body: putAutomationSettingsBody,
        response: { 200: automationSettingsSchema },
      },
    },
    async (req) => {
      const saved = await saveNotificationAutomationSettings(req.userId as number, req.body);
      await requestScheduleRemindersRun();
      return saved;
    },
  );
}
