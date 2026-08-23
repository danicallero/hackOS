import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireAuth, requireCapability } from "../../../lib/capabilities.js";
import {
  type RouteAccessPolicy,
  routeAccessOption as routeAccess,
} from "../../../lib/route-policy.js";
import { broadcast } from "../../../lib/sse.js";
import {
  createAnnouncement,
  deleteAnnouncement,
  fanOutIfVisibleNow,
  getAnnouncement,
  getAnnouncementRecipients,
  listAnnouncementRecipientCandidates,
  listAnnouncementsAdmin,
  listAnnouncementsPublic,
  markAnnouncementRead,
  updateAnnouncement,
} from "../announcements-service.js";
import {
  announcementBodySchema,
  announcementIdParamsSchema,
  announcementRecipientCandidatesQuerySchema,
  announcementTranslateBodySchema,
  announcementUpdateBodySchema,
} from "../schemas.js";
import { isTranslationAvailable, translateAnnouncementContent } from "../translate/index.js";

/**
 * H50 announcements: CRUD behind ANNOUNCEMENTS_MANAGE, a public visibility-windowed
 * feed, and per-user read markers. Create/update/delete broadcast
 * CONTENT_ANNOUNCEMENT on topic "content" for TV/panels (H41-H42 style live
 * refresh). When an opted-in announcement is visible, it fans out through
 * every recipient's enabled inbox/email/push preferences.
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
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: {
        summary: "List all announcements",
        description:
          "Lists all H50 announcements (regardless of publication window) for admin management and audit.",
      },
    },
    async () => {
      const items = await listAnnouncementsAdmin(pool);
      return { items };
    },
  );

  typedApp.get(
    "/api/announcements/recipient-candidates",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: {
        summary: "Search announcement recipient candidates",
        description:
          "Minimal account identity fields for an ANNOUNCEMENTS_MANAGE holder picking specific recipients — deliberately not gated by the broader USERS_READ.",
        querystring: announcementRecipientCandidatesQuerySchema,
      },
    },
    async (req) => ({
      users: await listAnnouncementRecipientCandidates(pool, req.query.q, req.query.limit),
    }),
  );

  typedApp.get(
    "/api/announcements/translate-availability",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: {
        summary: "Whether automatic translation is configured",
        description:
          "Lets both frontends hide/disable the auto-translate action when no provider is configured, instead of offering an action that will fail (see modules/notifications/translate/).",
      },
    },
    async () => ({ available: isTranslationAvailable() }),
  );

  typedApp.post(
    "/api/announcements/translate",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: {
        summary: "Auto-translate announcement content",
        description:
          "Machine-translates a title+body from sourceLanguage into each of targetLanguages via the configured provider (modules/notifications/translate/). Returns 503 when no provider is configured — always optional, manual translation entry keeps working either way.",
        body: announcementTranslateBodySchema,
      },
    },
    async (req) => {
      const { title, body, sourceLanguage, targetLanguages } = req.body;
      const translations = await translateAnnouncementContent(
        { title, body },
        sourceLanguage,
        targetLanguages,
      );
      return { translations };
    },
  );

  typedApp.get(
    "/api/announcements/:id",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: {
        summary: "Get announcement details",
        description:
          "Fetches a single H50 announcement including its full translations, delivery settings, audience/recipient targeting and publication window.",
        params: announcementIdParamsSchema,
      },
    },
    async (req) => {
      const announcement = await getAnnouncement(pool, req.params.id);
      const recipients = await getAnnouncementRecipients(pool, announcement.id);
      return { ...announcement, recipients };
    },
  );

  typedApp.post(
    "/api/announcements",
    {
      ...routeAccess(manage),
      preHandler: requireCapability(CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      schema: {
        summary: "Create announcement",
        description:
          "Creates an auditable announcement with one or more optional complete es/gl/en translations, a screen placement, and delivery settings. At least one complete language is enough; when the others are blank, that language becomes the canonical fallback for recipients. notifyUsers fans out through the chosen channels (candidates only — each still filtered by the recipient's own H51 preferences), addressed either to everyone (default), an audience of sponsor/participant/mentor tags, or an explicit recipient list — audience tags and an explicit recipient list are mutually exclusive, and a screen-placed announcement can't target specific recipients. A notify-only announcement (screenPlacement 'none') fires once at publishAt and can't have an expiresAt; screen-placed announcements keep the publishAt/expiresAt visibility window unchanged.",
        body: announcementBodySchema,
      },
    },
    async (req, reply) => {
      const body = req.body;
      const announcement = await withTransaction(async (client) => {
        const created = await createAnnouncement(client, req.userId as number, {
          title: body.title,
          body: body.body,
          translations: body.translations,
          notifyUsers: body.notifyUsers,
          screenPlacement: body.screenPlacement,
          publishAt: body.publishAt ?? null,
          expiresAt: body.expiresAt ?? null,
          audiences: body.audiences,
          channels: body.channels,
          recipientUserIds: body.recipientUserIds,
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
      schema: {
        summary: "Update announcement",
        description:
          "Updates an auditable announcement's translations, delivery opt-in, channels, audience/recipient targeting, screen placement or publication window (see the create route for the targeting/channel/window rules, which apply identically here). One complete language is enough when the other translations are blank, and becomes the canonical fallback for recipients without a matching translation. A notification fan-out occurs at most once when notifyUsers is enabled and the announcement becomes visible.",
        params: announcementIdParamsSchema,
        body: announcementUpdateBodySchema,
      },
    },
    async (req) => {
      const body = req.body;
      const announcement = await withTransaction(async (client) => {
        const before = await getAnnouncement(client, req.params.id);
        const updated = await updateAnnouncement(client, req.params.id, {
          title: body.title,
          body: body.body,
          translations: body.translations,
          notifyUsers: body.notifyUsers,
          screenPlacement: body.screenPlacement,
          publishAt: body.publishAt,
          expiresAt: body.expiresAt,
          audiences: body.audiences,
          channels: body.channels,
          recipientUserIds: body.recipientUserIds,
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
      schema: {
        summary: "Delete announcement",
        description:
          "Deletes the announcement in an audited transaction and emits a content invalidation so permanent TV placements disappear immediately.",
        params: announcementIdParamsSchema,
      },
    },
    async (req) => {
      const deleted = await withTransaction(async (client) => {
        const deleted = await deleteAnnouncement(client, req.params.id);
        await audit(client, {
          actorId: req.userId as number,
          entityType: "announcement",
          entityId: deleted.id,
          action: "delete",
          before: deleted,
        });
        return deleted;
      });
      await broadcast(SSE_TOPICS.CONTENT, EVENTS.CONTENT_ANNOUNCEMENT, {
        action: "delete",
        id: deleted.id,
      });
      return { ok: true };
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
