import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../../db/pool.js";
import { requireAuth } from "../../../lib/capabilities.js";
import { inboxQuerySchema, notificationIdParamsSchema } from "../schemas.js";
import { listInboxNotifications, markNotificationRead } from "../service.js";

/** H50/H51 in-app inbox: the outbox row itself is the inbox item, read_at is the read marker. */
export function registerInboxRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    "/api/me/notifications",
    { preHandler: requireAuth, schema: { querystring: inboxQuerySchema } },
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
    { preHandler: requireAuth, schema: { params: notificationIdParamsSchema } },
    async (req) => {
      return markNotificationRead(pool, req.userId as number, req.params.id);
    },
  );
}
