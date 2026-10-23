import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool, withTransaction } from "../../../db/pool.js";
import {
  getRequestAuthorizationContext,
  requireAuth,
  userHasCapability,
} from "../../../lib/capabilities.js";
import { ForbiddenError } from "../../../lib/errors.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import { broadcast } from "../../../lib/sse.js";
import { notificationOnboardingBodySchema, setPreferencesBodySchema } from "../schemas.js";
import {
  completeNotificationOnboarding,
  getPreferences,
  QUEUE_STAFF_CATEGORY,
  setPreferences,
} from "../service.js";

/** H51: participant-facing notification preference matrix, incl. schedule:<id> reminder opt-ins. */
export function registerPreferenceRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    "/api/me/notification-preferences",
    {
      ...routeAccess({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Get notification preferences",
        description:
          "Fetches the H51 preference matrix for the authenticated user, showing all available channels and any overrides from their stored preference rows.",
      },
    },
    async (req) => {
      return getPreferences(pool, req.userId as number);
    },
  );

  typedApp.put(
    "/api/me/notification-preferences",
    {
      ...routeAccess({ kind: "authenticated", emailVerification: "none" }),
      preHandler: requireAuth,
      schema: {
        summary: "Update notification preferences",
        description:
          "Sets H51 notification preference overrides for the authenticated user; queue-category notifications are mandatory and only their email can be chosen. Staff-category push is restricted to users with queue/judge access.",
        body: setPreferencesBodySchema,
      },
    },
    async (req) => {
      if (req.body.preferences.some((item) => item.category === QUEUE_STAFF_CATEGORY)) {
        const context = getRequestAuthorizationContext(req);
        const allowed = await Promise.all([
          userHasCapability(context, CAPABILITIES.QUEUE_OPERATE),
          userHasCapability(context, CAPABILITIES.QUEUE_ADMIN),
          userHasCapability(context, CAPABILITIES.JUDGE_PANEL),
        ]);
        if (!allowed.some(Boolean)) {
          throw new ForbiddenError("Queue staff notifications require queue or judging access");
        }
      }
      await withTransaction(async (client) => {
        await setPreferences(client, req.userId as number, req.body.preferences);
      });
      // Wakes the account's other devices so they reschedule their local reminders.
      await broadcast(
        `${SSE_TOPICS.USER_PREFIX}${req.userId}`,
        EVENTS.USER_NOTIFICATION_PREFERENCES_CHANGED,
        {},
      );
      return getPreferences(pool, req.userId as number);
    },
  );

  typedApp.post(
    "/api/me/notification-preferences/onboarding",
    {
      ...routeAccess({ kind: "authenticated", emailVerification: "none" }),
      preHandler: requireAuth,
      schema: {
        summary: "Complete the first-run notification channel prompt",
        description:
          "Stores the channel choices made in the first-run prompt shown to people with event access and marks the account as onboarded, so web and mobile stop asking. Idempotent; email for queue, activity-reminder and challenge notices is off by default unless the person has no mobile device registered (H51).",
        body: notificationOnboardingBodySchema,
      },
    },
    async (req) => {
      await withTransaction(async (client) => {
        await completeNotificationOnboarding(client, req.userId as number, req.body.preferences);
      });
      await broadcast(
        `${SSE_TOPICS.USER_PREFIX}${req.userId}`,
        EVENTS.USER_NOTIFICATION_PREFERENCES_CHANGED,
        {},
      );
      return getPreferences(pool, req.userId as number);
    },
  );
}
