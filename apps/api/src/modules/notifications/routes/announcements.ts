import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireAuth, requireCapability } from "../../../lib/capabilities.js";
import type { RouteAccessPolicy } from "../../../lib/route-policy.js";
import { broadcast } from "../../../lib/sse.js";
import {
  createAnnouncement,
  deleteAnnouncement,
  fanOutIfVisibleNow,
  getAnnouncement,
  listAnnouncementsAdmin,
  listAnnouncementsPublic,
  markAnnouncementRead,
  updateAnnouncement,
} from "../announcements-service.js";
import {
  announcementBodySchema,
  announcementIdParamsSchema,
  announcementUpdateBodySchema,
} from "../schemas.js";

function routeAccess(routeAccessPolicy: RouteAccessPolicy) {
  return { config: { routeAccessPolicy } };
}

/**
 * H50 announcements: CRUD behind ANNOUNCEMENTS_MANAGE, a public visibility-windowed
 * feed, and per-user read markers. Create/update broadcast CONTENT_ANNOUNCEMENT on
 * topic "content" for TV/panels (H41-H42 style live refresh) and, when the row is
 * visible right now, fan out in_app+push outbox rows to the target audience.
 */
export function registerAnnouncementRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const publicAnnouncement = {
    kind: "public",
    anonymousCategory: "public-announcement",
  } as const satisfies RouteAccessPolicy;
  const authenticated = { kind: "authenticated" } as const satisfies RouteAccessPolicy;
  const manage = {
    kind: "capability",
    capability: CAPABILITIES.ANNOUNCEMENTS_MANAGE,
  } as const satisfies RouteAccessPolicy;

  typedApp.get(
    "/api/announcements/public",
    {
      ...routeAccess(publicAnnouncement),
      schema: {
        summary: "Published announcements",
        description:
          "Anonymous H50 announcement feed. It contains only announcements inside their configured publication and expiry window.",
      },
    },
    async () => {
      const items = await listAnnouncementsPublic(pool);
      return { items };
    },
  );

  typedApp.get(
    "/api/announcements",
    { ...routeAccess(manage), preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE) },
    async () => {
      const items = await listAnnouncementsAdmin(pool);
      return { items };
    },
  );

  typedApp.get(
    "/api/announcements/:id",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: { params: announcementIdParamsSchema },
    },
    async (req) => {
      return getAnnouncement(pool, req.params.id);
    },
  );

  typedApp.post(
    "/api/announcements",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: { body: announcementBodySchema },
    },
    async (req, reply) => {
      const body = req.body;
      const announcement = await withTransaction(async (client) => {
        const created = await createAnnouncement(client, req.userId as number, {
          title: body.title,
          body: body.body,
          targetRole: body.targetRole ?? null,
          publishAt: body.publishAt ?? null,
          expiresAt: body.expiresAt ?? null,
        });
        await audit(client, {
          actorId: req.userId as number,
          entityType: "announcement",
          entityId: created.id,
          action: "create",
          after: created,
        });
        await fanOutIfVisibleNow(client, created);
        return created;
      });
      await broadcast(SSE_TOPICS.CONTENT, EVENTS.CONTENT_ANNOUNCEMENT, announcement);
      reply.code(201);
      return announcement;
    },
  );

  typedApp.put(
    "/api/announcements/:id",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: { params: announcementIdParamsSchema, body: announcementUpdateBodySchema },
    },
    async (req) => {
      const body = req.body;
      const announcement = await withTransaction(async (client) => {
        const before = await getAnnouncement(client, req.params.id);
        const updated = await updateAnnouncement(client, req.params.id, {
          title: body.title,
          body: body.body,
          targetRole: body.targetRole,
          publishAt: body.publishAt,
          expiresAt: body.expiresAt,
        });
        await audit(client, {
          actorId: req.userId as number,
          entityType: "announcement",
          entityId: updated.id,
          action: "update",
          before,
          after: updated,
        });
        await fanOutIfVisibleNow(client, updated);
        return updated;
      });
      await broadcast(SSE_TOPICS.CONTENT, EVENTS.CONTENT_ANNOUNCEMENT, announcement);
      return announcement;
    },
  );

  typedApp.delete(
    "/api/announcements/:id",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: { params: announcementIdParamsSchema },
    },
    async (req) => {
      return withTransaction(async (client) => {
        const deleted = await deleteAnnouncement(client, req.params.id);
        await audit(client, {
          actorId: req.userId as number,
          entityType: "announcement",
          entityId: deleted.id,
          action: "delete",
          before: deleted,
        });
        return { ok: true };
      });
    },
  );

  typedApp.post(
    "/api/announcements/:id/read",
    {
      ...routeAccess(authenticated),
      preHandler: requireAuth,
      schema: { params: announcementIdParamsSchema },
    },
    async (req) => {
      await markAnnouncementRead(pool, req.userId as number, req.params.id);
      return { ok: true };
    },
  );
}
