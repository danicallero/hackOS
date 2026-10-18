import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../../db/pool.js";
import { requireAuth } from "../../../lib/capabilities.js";
import { NotFoundError } from "../../../lib/errors.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import { readNotificationAutomationSettings } from "../automation-settings.js";
import { localRemindersBodySchema } from "../schemas.js";

/**
 * H51/H59: phones schedule activity reminders themselves (also offline) from
 * the schedule, the person's opt-ins and these event-level settings. The
 * server keeps sending the push as a fallback to any device that has not
 * reported covering the item (see schedule-reminders.ts).
 */
export function registerLocalReminderRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    "/api/me/reminder-settings",
    {
      ...routeAccess({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Read the activity reminder settings",
        description:
          "Event-level on/off switch and lead time of activity reminders (H45, H51), readable by any signed-in account so a device can schedule its own reminders.",
        response: {
          200: z.object({ enabled: z.boolean(), leadMinutes: z.number().int() }),
        },
      },
    },
    async () => {
      const settings = await readNotificationAutomationSettings();
      return {
        enabled: settings.scheduleRemindersEnabled,
        leadMinutes: settings.scheduleReminderLeadMinutes,
      };
    },
  );

  api.put(
    "/api/me/local-reminders",
    {
      ...routeAccess({ kind: "authenticated", emailVerification: "none" }),
      preHandler: requireAuth,
      schema: {
        summary: "Report the reminders this device schedules locally",
        description:
          "Replaces the list of schedule items (id and start instant) this device has scheduled a local reminder for, with the lead time used. While the report is fresh the server skips the push channel of the activity reminder for users whose every device covers the item; any device without a matching report still gets the server push. Idempotent.",
        body: localRemindersBodySchema,
        response: { 200: z.object({ status: z.literal(true) }) },
      },
    },
    async (req) => {
      const { token, leadMinutes, items } = req.body;
      const { rowCount } = await pool.query(
        `UPDATE push_tokens
            SET local_reminders = $3::jsonb,
                local_reminders_lead_minutes = $4,
                local_reminders_synced_at = now()
          WHERE user_id = $1 AND token = $2`,
        [req.userId, token, JSON.stringify(items), leadMinutes],
      );
      if (!rowCount) throw new NotFoundError("Push token not registered for this account");
      return { status: true as const };
    },
  );
}
