import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../../db/pool.js";
import { requireAuth } from "../../../lib/capabilities.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import { inboxQuerySchema, notificationIdParamsSchema } from "../schemas.js";
import {
  deleteInboxNotification,
  listInboxNotifications,
  markNotificationRead,
} from "../service.js";

/** H50/H51 in-app inbox: the outbox row itself is the inbox item, read_at is the read marker. */
export function registerInboxRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    "/api/me/notifications",
    {
      ...routeAccess({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "List in-app notifications",
        description:
          "Paginated H50/H51 in-app inbox for the authenticated user, optionally filtered to unread items only. The outbox row itself is the inbox item.",
        querystring: inboxQuerySchema,
      },
    },
    async (req) => {
      const { unread, limit, offset } = req.query;
      return listInboxNotifications(pool, req.userId as number, {
        unreadOnly: unread,
        limit,
        offset,
      });
    },
  );

  typedApp.post(
    "/api/me/notifications/:id/read",
    {
      ...routeAccess({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Mark notification as read",
        description:
          "Sets the read_at timestamp on a single H50/H51 in-app inbox item belonging to the caller (idempotent).",
        params: notificationIdParamsSchema,
      },
    },
    async (req) => {
      return markNotificationRead(pool, req.userId as number, req.params.id);
    },
  );

  typedApp.delete(
    "/api/me/notifications/:id",
    {
      ...routeAccess({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Delete an inbox notification",
        description:
          "Removes a single H50/H51 in-app inbox row belonging to the caller. Only the " +
          "in_app outbox row is deleted, so this never touches email/push delivery " +
          "records for the same notification.",
        params: notificationIdParamsSchema,
      },
    },
    async (req) => {
      return deleteInboxNotification(pool, req.userId as number, req.params.id);
    },
  );
}
