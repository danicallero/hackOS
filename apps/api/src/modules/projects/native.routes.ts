import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  projectDraftSchema,
  projectFormSchema,
  projectGalleryQuerySchema,
} from "@hackos/shared/projects";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { sharedCache } from "../../lib/shared-cache.js";
import { visibleWinnerRows } from "../challenges/winner-publication.js";
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

/** Backstop for clock boundaries (winner reveal) that emit no event; events invalidate sooner (H18). */
const GALLERY_CACHE_TTL_SECONDS = 30;

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
          "Counts each native project once, active members only, with sponsor enterprise scope and no planning/submitted double count (H21). Includes challenge mandatory flags for the authorized project enrollment chooser.",
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
          "Creates an audited immutable project form version with organizer-defined questions, question-owned libraries and optional YouTube presentation. Removing a library requires its UUID in library_deletions and deletes all catalogue values transactionally. Existing submission snapshots retain their original version (#1007,H16,H54).",
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
          "Validates configured required questions, designated YouTube video links, the shared form, file ownership and team size, locks the same project and snapshots answers, roster, challenges and form version (#1006,#1007).",
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
        description:
          "Reads the authorized working copy, with member/edit/submit/inspection flags, organizer locks, approved reopening and unsubmitted-change status through the centralized team and phase policy (H20,H21).",
      },
    },
    (q) => nativeProject(q.userId, q.params.id),
  );
  r.get(
    "/api/public/projects",
    {
      ...publicRead,
      schema: {
        querystring: projectGalleryQuerySchema,
        summary: "List project gallery",
        description:
          "Paginated no-store project gallery honoring SQL-clock opening, audience, draft visibility and current name/photo consent on every read (#1008,#1009). Optional winnersOnly=true filters published winners before pagination; with challengeId it matches winners of that challenge (H60). Project staff (PROJECTS_READ) may browse before it opens. The audience-independent projection is computed once and shared through Valkey (30 s TTL, invalidated by project, public-content and directory changes); the viewer's own projects are always read live. A refusal is 403 with `details.reason` `gallery_closed` (with `details.opensAt`, null while unscheduled, and the event `details.timeZone`) or `gallery_audience` (H18).",
      },
    },
    async (q, reply) => {
      reply.header("Cache-Control", "no-store");
      await assertGalleryVisible(pool, q.userId);
      const phase = await projectPhase(pool);
      const viewer = await projectViewer(pool, q.userId);
      const { page, pageSize, search, challengeId, winnersOnly } = q.query;
      // One request computes the viewer-independent projection; every other
      // phone in the same audience reads it from the shared cache (H18).
      const shared = await sharedCache(
        "gallery",
        JSON.stringify([
          phase.draftVisibility,
          // Attendance only changes the list while drafts are for attendees.
          phase.draftVisibility === "attendees" ? viewer.attendee : null,
          search ?? null,
          challengeId ?? null,
          winnersOnly ?? false,
          page,
          pageSize,
        ]),
        GALLERY_CACHE_TTL_SECONDS,
        async () => {
          const winnerIds = winnersOnly
            ? (await visibleWinnerRows(pool, null, undefined, true))
                .filter((winner) => !challengeId || winner.challengeId === challengeId)
                .map((winner) => winner.repoId)
            : null;
          const { rows } = await pool.query(
            `SELECT r.id,count(*) OVER()::int AS total FROM repos r WHERE r.is_test_account=false AND (r.submission_status='submitted' OR ($1<>'team_only' AND ($1='public' OR $2))) AND ($3::text IS NULL OR r.name ILIKE '%'||$3||'%') AND ($4::int IS NULL OR EXISTS(SELECT 1 FROM project_challenges pc WHERE pc.repo_id=r.id AND pc.challenge_id=$4)) AND ($7::int[] IS NULL OR r.id=ANY($7)) ORDER BY r.id LIMIT $5 OFFSET $6`,
            [
              phase.draftVisibility,
              viewer.attendee,
              search ?? null,
              challengeId ?? null,
              pageSize,
              (page - 1) * pageSize,
              winnerIds,
            ],
          );
          const ids = rows.map((row) => row.id as number);
          return {
            items: await nativeProjects(null, ids, { gallery: true, galleryChecked: true }),
            total: (rows[0]?.total ?? 0) as number,
          };
        },
      );
      // Only the viewer's own projects differ (team content), so just those are read live.
      const own =
        q.userId === null || !shared.items.length
          ? []
          : (
              await pool.query<{ repo_id: number }>(
                `SELECT repo_id FROM submissions WHERE user_id=$1 AND status='active' AND repo_id=ANY($2::int[])`,
                [q.userId, shared.items.map((item) => item.id)],
              )
            ).rows.map((row) => row.repo_id);
      const ownProjects = own.length ? await nativeProjects(q.userId, own, { gallery: true }) : [];
      return {
        items: shared.items.map((item) => ownProjects.find((mine) => mine.id === item.id) ?? item),
        total: shared.total,
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
          "Returns no-store gallery content from the last submitted snapshot, including for the project’s own team, and current consented active member display through the gallery phase policy; names are null when sharing is disabled (#1008,#1009).",
      },
    },
    (q, reply) => {
      reply.header("Cache-Control", "no-store");
      return nativeProject(q.userId, q.params.id, { gallery: true });
    },
  );
}
