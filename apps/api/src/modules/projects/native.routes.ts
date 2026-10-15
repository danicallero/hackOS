import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  projectDraftSchema,
  projectFormSchema,
  projectGalleryConsentSchema,
  projectGalleryQuerySchema,
} from "@hackos/shared/projects";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { repositoryScopeFor, requireRepositoryListAccess } from "./access.js";
import {
  decideNativeEdits,
  nativeForm,
  nativeProject,
  nativeProjects,
  projectEstimates,
  requestNativeEdits,
  saveNativeDraft,
  saveNativeForm,
  submitNativeProject,
} from "./native.js";
import { assertGalleryVisible, projectPhase, projectViewer } from "./policy.js";
import { addMyProjectChallenge } from "./service.js";

const params = z.object({ id: z.coerce.number().int().positive() });
const auth = {
  config: { routeAccessPolicy: { kind: "authenticated" as const } },
  preHandler: [requireAuth, idempotencyGuard],
};
const staff = {
  config: {
    routeAccessPolicy: { kind: "capability" as const, capability: CAPABILITIES.PROJECTS_EDIT },
  },
  preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
};
const publicRead = {
  config: {
    routeAccessPolicy: { kind: "public" as const, anonymousCategory: "public-content" as const },
  },
};
export function registerNativeProjectRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/projects/estimates",
    {
      config: { routeAccessPolicy: { kind: "contextual", policy: "repository-list" } },
      preHandler: requireRepositoryListAccess,
      schema: {
        summary: "Read project challenge estimates",
        description:
          "Counts each native project once, active members only, with sponsor enterprise scope and no planning/submitted double count (H21).",
      },
    },
    (q) => {
      const scope = repositoryScopeFor(q);
      return projectEstimates(
        scope.fullAccess ? "all" : scope.challengeIds,
        scope.fixtureMarker === true,
      );
    },
  );

  r.post(
    "/api/me/projects/:id/edit-requests",
    {
      ...auth,
      schema: {
        params,
        body: z.object({ reason: z.string().trim().min(1).max(1000) }),
        summary: "Request project edits",
        description:
          "Records an audited exception request without changing the last submitted snapshot (H20,H53).",
      },
    },
    (q) => requestNativeEdits(q.userId as number, q.params.id, q.body.reason),
  );
  r.post(
    "/api/projects/:id/unlock",
    {
      ...staff,
      schema: {
        params,
        body: z.object({
          reason: z.string().trim().min(1).max(1000),
          decision: z.enum(["approve", "deny", "unlock"]),
        }),
        summary: "Decide project editing",
        description:
          "Audited organizer decision reopens the same project for edits with submission history retained and resubmission required (H21,H53).",
      },
    },
    (q) => decideNativeEdits(q.userId as number, q.params.id, q.body.reason, q.body.decision),
  );

  r.put(
    "/api/me/projects/:id/challenges/:challengeId",
    {
      ...auth,
      schema: {
        params: params.extend({ challengeId: z.coerce.number().int().positive() }),
        summary: "Enter project in challenge",
        description:
          "An active member records native challenge intent, with an audited idempotent live queue correction when a queue exists (H20,H21).",
      },
    },
    (q) => addMyProjectChallenge(q.userId as number, q.params.id, q.params.challengeId),
  );

  r.get(
    "/api/projects/form",
    {
      ...auth,
      preHandler: requireAuth,
      schema: {
        summary: "Read project form",
        description:
          "Returns the current shared application-form definition and immutable version used by projects (#1007).",
      },
    },
    () => nativeForm(),
  );
  r.put(
    "/api/projects/form",
    {
      ...staff,
      schema: {
        body: projectFormSchema,
        summary: "Define project form",
        description:
          "Creates an audited immutable project form version; existing submission snapshots retain their original version (#1007).",
      },
    },
    (q) => saveNativeForm(q.userId as number, q.body),
  );
  r.put(
    "/api/repos/:id/draft",
    {
      ...staff,
      schema: {
        params,
        body: projectDraftSchema,
        summary: "Correct project answers",
        description:
          "Staff correct answers with revision conflict protection and transactional audit, independently of participant editing windows (H21,H53).",
      },
    },
    (q) =>
      saveNativeDraft(q.userId as number, q.params.id, q.body.responses, q.body.revision, true),
  );
  r.put(
    "/api/me/projects/:id/draft",
    {
      ...auth,
      schema: {
        params,
        body: projectDraftSchema,
        summary: "Autosave project draft",
        description:
          "Atomically saves answers only when revision matches; rejects stale edits without overwriting newer answers (#1007).",
      },
    },
    (q) => saveNativeDraft(q.userId as number, q.params.id, q.body.responses, q.body.revision),
  );
  r.post(
    "/api/me/projects/:id/submit",
    {
      ...auth,
      schema: {
        params,
        summary: "Submit project",
        description:
          "Validates the shared form, file ownership and team size, locks the same project and snapshots answers, roster, challenges and form version (#1006,#1007).",
      },
    },
    (q) => submitNativeProject(q.userId as number, q.params.id),
  );
  r.get(
    "/api/me/projects/:id",
    {
      ...auth,
      preHandler: requireAuth,
      schema: {
        params,
        summary: "Read my project",
        description: "Reads one project through the centralized team and phase policy (#1008).",
      },
    },
    (q) => nativeProject(q.userId, q.params.id),
  );
  r.get(
    "/api/me/project-gallery-consent",
    {
      ...auth,
      preHandler: requireAuth,
      schema: {
        summary: "Read gallery consent",
        description:
          "Returns explicit gallery name/photo choices independently of directory consent (#1009).",
      },
    },
    async (q) => {
      const { rows } = await pool.query(
        `SELECT gallery_show_name AS "showName",gallery_show_photo AS "showPhoto" FROM users WHERE id=$1`,
        [q.userId],
      );
      return rows[0];
    },
  );
  r.put(
    "/api/me/project-gallery-consent",
    {
      ...auth,
      schema: {
        body: projectGalleryConsentSchema,
        summary: "Set gallery consent",
        description:
          "Records explicit consent for a potentially public and indexable project gallery; photos default to hidden (#1009,H53).",
      },
    },
    (q) =>
      withTransaction(async (db) => {
        await db.query(
          `UPDATE users SET gallery_show_name=$2,gallery_show_photo=$3,gallery_consented_at=now() WHERE id=$1`,
          [q.userId, q.body.showName, q.body.showPhoto],
        );
        await audit(db, {
          actorId: q.userId,
          entityType: "user",
          entityId: q.userId as number,
          action: "gallery_consent",
          after: q.body,
        });
        return q.body;
      }),
  );
  r.get(
    "/api/public/projects",
    {
      ...publicRead,
      schema: {
        querystring: projectGalleryQuerySchema,
        summary: "List project gallery",
        description:
          "Paginated no-store project gallery honoring SQL-clock opening, audience, draft visibility and current name/photo consent on every read (#1008,#1009). Project staff (PROJECTS_READ) may browse before it opens. A refusal is 403 with `details.reason` `gallery_closed` (with `details.opensAt`, null while unscheduled) or `gallery_audience` (H18).",
      },
    },
    async (q, reply) => {
      reply.header("Cache-Control", "no-store");
      await assertGalleryVisible(pool, q.userId);
      const phase = await projectPhase(pool);
      const viewer = await projectViewer(pool, q.userId);
      const { page, pageSize, search, challengeId } = q.query;
      const { rows } = await pool.query(
        `SELECT r.id,count(*) OVER()::int AS total FROM repos r WHERE r.is_test_account=false AND (r.submission_status='submitted' OR ($1<>'team_only' AND ($1='public' OR $2))) AND ($3::text IS NULL OR r.name ILIKE '%'||$3||'%') AND ($4::int IS NULL OR EXISTS(SELECT 1 FROM project_challenges pc WHERE pc.repo_id=r.id AND pc.challenge_id=$4)) ORDER BY r.id LIMIT $5 OFFSET $6`,
        [
          phase.draftVisibility,
          viewer.attendee,
          search ?? null,
          challengeId ?? null,
          pageSize,
          (page - 1) * pageSize,
        ],
      );
      return {
        items: await nativeProjects(
          q.userId,
          rows.map((row) => row.id),
        ),
        total: rows[0]?.total ?? 0,
        page,
        pageSize,
      };
    },
  );
  r.get(
    "/api/public/projects/:id",
    {
      ...publicRead,
      schema: {
        params,
        summary: "Read gallery project",
        description:
          "Returns no-store project content and current consented member display through the gallery phase policy; nonmembers receive null names when sharing is disabled (#1008,#1009).",
      },
    },
    (q, reply) => {
      reply.header("Cache-Control", "no-store");
      return nativeProject(q.userId, q.params.id);
    },
  );
}
