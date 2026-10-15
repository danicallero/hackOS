import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import type { RouteAccessPolicy } from "../../lib/route-policy.js";
import {
  repositoryScopeFor,
  requireRepositoryAccess,
  requireRepositoryListAccess,
} from "./access.js";
import {
  challengeIdOnlyParamsSchema,
  createMyProjectBodySchema,
  createRepoBodySchema,
  inviteProjectMemberBodySchema,
  repoChallengeBodySchema,
  repoChallengeParamsSchema,
  repoIdParamsSchema,
  repoMemberBodySchema,
  repoMemberParamsSchema,
  updateRepoBodySchema,
} from "./schemas.js";
import {
  acceptProjectInvite,
  addMyProjectChallenge,
  addRepoChallenge,
  addRepoMember,
  bulkAddRepoChallenge,
  bulkRemoveRepoChallenge,
  canCreateMyProject,
  createMyProject,
  createRepoNative,
  declineProjectInvite,
  deleteMyProject,
  deleteRepo,
  getRepoForScope,
  inviteProjectMember,
  leaveMyProject,
  listProjectMemberCandidates,
  listPublicChallenges,
  listReposForScope,
  myPendingInvites,
  myProjects,
  removeMyProjectChallenge,
  removeRepoChallenge,
  removeRepoMember,
  updateMyProject,
  updateRepo,
} from "./service.js";

/**
 * Projects routes: native intake (H16-H17), the PROJECTS_READ views the
 * queue workstream consumes, hot edits (H21), and the native lifecycle —
 * org-side creation/metadata edits (H18) plus policy-gated participant
 * self-creation (H19) and the participant self-view (H20).
 */
const access = (routeAccessPolicy: RouteAccessPolicy) => ({ config: { routeAccessPolicy } });
const repoParam = { source: "params", field: "id" } as const;

export function registerProjectRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const publicChallengeSchema = z.object({
    id: z.number().int(),
    title: z.record(z.string(), z.string()),
    description: z.record(z.string(), z.string()),
    criteria: z.record(z.string(), z.string()),
    prizes: z.unknown(),
    availableFrom: z.string().nullable(),
    winners: z
      .array(
        z.object({
          challengeId: z.number(),
          rank: z.number(),
          repoId: z.number(),
          challengeTitle: z.string(),
          repoName: z.string(),
        }),
      )
      .optional(),
    enterprise: z.object({
      id: z.number().int(),
      name: z.string(),
      logoUrl: z.string().nullable(),
      logoNegativeUrl: z.string().nullable(),
      website: z.string().nullable(),
    }),
  });

  r.get(
    "/api/public/challenges",
    {
      ...access({ kind: "public", anonymousCategory: "public-content" }),
      schema: {
        summary: "List public challenges",
        description: "Lists published challenges for anonymous visitors (H45).",
        response: { 200: z.object({ items: z.array(publicChallengeSchema) }) },
      },
    },
    async (q) => ({ items: await listPublicChallenges(q.userId) }),
  );

  // Public sponsors live in the sponsors module now: GET /api/public/sponsors
  // reveals enterprises by their OWN visibility window (H45), no longer derived
  // from published challenges.

  r.delete(
    "/api/me/projects/:repoId/challenges/:challengeId",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: repoChallengeParamsSchema,
        summary: "Withdraw my project from an optional challenge",
        description:
          "An active member may withdraw their project before judging starts. Mandatory challenges cannot be withdrawn. The queue transition and audit are transactional and idempotent (H20/H21).",
      },
    },
    async (q) =>
      removeMyProjectChallenge(q.userId as number, q.params.repoId, q.params.challengeId),
  );

  // ── PROJECTS_READ views ───────────────────────────────────────────────────

  // H8/H44/H46: full-access sees all repos; judges/sponsors see only the
  // projects of participants in THEIR challenges (empty list if they have none).
  r.get(
    "/api/repos",
    {
      ...access({
        kind: "contextual",
        policy: "repository-list",
      }),
      preHandler: requireRepositoryListAccess,
      schema: {
        summary: "List scoped projects",
        description:
          "Global project readers see all projects; sponsor representatives and assigned judges see only their exact challenge scope. Challenge rows include mandatory participation, logical queue position, ETA minutes and possible rooms (H20, H38, H46).",
      },
    },
    async (req) => {
      return { repos: await listReposForScope(repositoryScopeFor(req)) };
    },
  );

  r.get(
    "/api/repos/:id",
    {
      ...access({ kind: "contextual", policy: "repository-access", resource: repoParam }),
      preHandler: requireRepositoryAccess(repoParam),
      schema: {
        params: repoIdParamsSchema,
        summary: "Get scoped project",
        description:
          "Returns project metadata, roster and challenges with logical queue positions, ETA minutes and possible rooms, only after exact repository authorization (H20, H38, H46).",
      },
    },
    async (req) => getRepoForScope(req.params.id, repositoryScopeFor(req)),
  );

  r.get(
    "/api/projects/member-candidates",
    {
      ...access({
        kind: "capability",
        capability: CAPABILITIES.PROJECTS_EDIT,
      }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        querystring: z.object({
          q: z.string().trim().min(2),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        summary: "Search project member candidates",
        description:
          "Returns minimal searchable account identity fields for project editors adding native team members (H21).",
        response: {
          200: z.object({
            users: z.array(
              z.object({
                id: z.number().int(),
                email: z.string(),
                name: z.string().nullable(),
                surname: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => ({
      users: await listProjectMemberCandidates(req.query.q, req.query.limit, req.userId as number),
    }),
  );

  // ── H18: native creation + metadata edits ────────────────────────────────

  r.post(
    "/api/repos",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
      schema: {
        summary: "Create a project natively (H18), no native involved.",
        description:
          "Creates a repo with title/description/links, initial team members and challenge lineup in one transaction. Each challenge enqueues the team at the bottom of that challenge's queue, exactly like a hot edit (H21). Audited; idempotent via Idempotency-Key.",
        body: createRepoBodySchema,
      },
    },
    async (req) => createRepoNative(req.userId as number, req.body),
  );

  r.patch(
    "/api/repos/:id",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        summary: "Edit a project's metadata and judging preference (H18).",
        description:
          "Updates only the fields present in the body. Judging preference cannot change after queue generation. Team membership and challenge lineup have their own H21 routes. Audited with before/after.",
        params: repoIdParamsSchema,
        body: updateRepoBodySchema,
      },
    },
    async (req) => updateRepo(req.userId as number, req.params.id, req.body),
  );

  // H21: hot-edit team membership and queue membership for a repo.
  r.post(
    "/api/repos/:repoId/members",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
      schema: {
        params: repoMemberParamsSchema.pick({ repoId: true }),
        body: repoMemberBodySchema,
        summary: "Add project member",
        description: "Adds a member to an exact project under global project-edit access (H21).",
      },
    },
    async (req) => addRepoMember(req.userId as number, req.params.repoId, req.body.userId),
  );

  r.delete(
    "/api/repos/:id",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
      schema: {
        params: repoIdParamsSchema,
        summary: "Delete a project",
        description:
          "A project editor can permanently delete any project and its dependent queue, judging, roster and native rows in one audited transaction.",
      },
    },
    async (req) => deleteRepo(req.userId as number, req.params.id),
  );

  r.delete(
    "/api/repos/:repoId/members/:userId",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        params: repoMemberParamsSchema,
        summary: "Remove project member",
        description: "Removes the exact member from the exact project (H21).",
      },
    },
    async (req) => removeRepoMember(req.userId as number, req.params.repoId, req.params.userId),
  );

  r.post(
    "/api/repos/:repoId/challenges",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
      schema: {
        params: repoChallengeParamsSchema.pick({ repoId: true }),
        body: repoChallengeBodySchema,
        summary: "Enter project in challenge",
        description: "Adds one exact project to one exact challenge queue (H21).",
      },
    },
    async (req) => addRepoChallenge(req.userId as number, req.params.repoId, req.body.challengeId),
  );

  r.delete(
    "/api/repos/:repoId/challenges/:challengeId",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        params: repoChallengeParamsSchema,
        summary: "Withdraw project from challenge",
        description: "Removes the exact project from the exact challenge queue (H21).",
      },
    },
    async (req) =>
      removeRepoChallenge(req.userId as number, req.params.repoId, req.params.challengeId),
  );

  // H21 "apuntar/dar de baja TODOS los proyectos": bulk enrollment, admin-only
  // (an operational tool, distinct from a sponsor's per-challenge content edit).
  r.post(
    "/api/challenges/:challengeId/repos/bulk-add",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
      schema: {
        params: challengeIdOnlyParamsSchema,
        summary: "Bulk-enter projects",
        description:
          "Adds every project to one exact challenge under global project-edit access (H21).",
      },
    },
    async (req) => bulkAddRepoChallenge(req.userId as number, req.params.challengeId),
  );

  r.post(
    "/api/challenges/:challengeId/repos/bulk-remove",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        params: challengeIdOnlyParamsSchema,
        summary: "Bulk-withdraw projects",
        description:
          "Removes projects from one exact challenge under global project-edit access (H21).",
      },
    },
    async (req) => bulkRemoveRepoChallenge(req.userId as number, req.params.challengeId),
  );

  // ── H19-H20: participant self-view + policy-gated self-creation ──────────

  r.get(
    "/api/me/projects",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "My projects (H19/H20): team roster, challenges and queue status.",
        description:
          "Projects the caller is an ACTIVE member of (a pending invite doesn't count — see GET .../invites), with team members, challenge lineup and live queue positions. Teammate emails come back as null — only the caller's own address is included. `canCreate` reflects the event's H19 policy AND the caller's own eligibility (admitted participant) AND whether the hacking window is currently open; it no longer requires the caller to have zero projects, since self-service now allows more than one.",
      },
    },
    async (req) => ({
      projects: await myProjects(req.userId as number),
      canCreate: await canCreateMyProject(req.userId as number),
    }),
  );

  r.post(
    "/api/me/projects",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        summary: "Create my own project (H19) — policy, eligibility and window gated.",
        description:
          "403 unless event settings enable participant project creation, the caller is an admitted participant, and the event's hacking window is open. A participant may now belong to more than one project — there is no longer a 409 for already belonging to one. The caller becomes the first team member; chosen (publicly visible) challenges enqueue the team at the bottom of their queues. Audited; idempotent via Idempotency-Key.",
        body: createMyProjectBodySchema,
      },
    },
    async (req) => createMyProject(req.userId as number, req.body),
  );

  // ── H19/H20: policy-gated participant self-service (edit, invites, leave,
  // delete) — product decision superseding H20's literal read-only text
  // while the event's H19 policy is on; recorded in docs/projects.md.
  // Every mutation here is additionally gated by the hacking window and by
  // "admitted participant" eligibility (assertWithinHackingWindow /
  // isAdmittedParticipant in service.ts).

  r.patch(
    "/api/me/projects/:id",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: repoIdParamsSchema,
        body: updateRepoBodySchema,
        summary: "Edit my own project (H19/H20) — active members only.",
        description:
          "Updates only the fields present in the body, including judging preference until queue generation. 403 if the caller isn't an active member of this project or the hacking window is closed. Audited (source: participant).",
      },
    },
    async (req) => updateMyProject(req.userId as number, req.params.id, req.body),
  );

  r.post(
    "/api/me/projects/:id/invites",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: repoIdParamsSchema,
        body: inviteProjectMemberBodySchema,
        summary: "Invite a teammate to my project (H19/H20).",
        description:
          "Only an active member may invite; the invitee must have an account and be an admitted participant, and must not already be an active member of this project. Creates a pending invite (submissions.status='invited') and notifies the invitee; idempotent for a repeat invite to the same person. 403 outside the hacking window.",
      },
    },
    async (req) => inviteProjectMember(req.userId as number, req.params.id, req.body.email),
  );

  r.post(
    "/api/me/projects/:id/challenges",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: repoIdParamsSchema,
        body: repoChallengeBodySchema,
        summary: "Enter my project in a challenge.",
        description:
          "An active project member can add one published challenge until judging starts. The project is appended to that challenge's queue; the transition is audited and idempotent.",
      },
    },
    async (req) => addMyProjectChallenge(req.userId as number, req.params.id, req.body.challengeId),
  );

  r.get(
    "/api/me/projects/invites",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "My pending project invites (H19/H20).",
        description:
          "Lists pending project invites addressed to the caller, newest first, with invitedBy as the active inviter's display name or null rather than an internal user ID (H19).",
      },
    },
    async (req) => ({ invites: await myPendingInvites(req.userId as number) }),
  );

  r.post(
    "/api/me/projects/:id/invites/accept",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: repoIdParamsSchema,
        summary: "Accept a pending project invite (H19/H20).",
        description:
          "Flips the caller's own pending invite for this exact project to an active membership. 404 if the caller has no pending invite for it (including when it's someone else's invite). 403 outside the hacking window.",
      },
    },
    async (req) => acceptProjectInvite(req.userId as number, req.params.id),
  );

  r.post(
    "/api/me/projects/:id/invites/decline",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: repoIdParamsSchema,
        summary: "Decline a pending project invite (H19/H20).",
        description:
          "Removes the caller's own pending invite for this exact project entirely. 404 if the caller has no pending invite for it. 403 outside the hacking window.",
      },
    },
    async (req) => declineProjectInvite(req.userId as number, req.params.id),
  );

  r.delete(
    "/api/me/projects/:id/leave",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: repoIdParamsSchema,
        summary: "Leave my own project (H19/H20).",
        description:
          "Removes the caller from the project's active roster. 409 if the caller is the last remaining member — delete the project instead. 403 if not a member, or outside the hacking window.",
      },
    },
    async (req) => leaveMyProject(req.userId as number, req.params.id),
  );

  r.delete(
    "/api/me/projects/:id",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: repoIdParamsSchema,
        summary: "Delete my own project (H19/H20) — sole member only.",
        description:
          "Deletes the project outright, including its queue entries, judging data and roster. Only allowed when the caller is the project's sole remaining active member and judging has not started; 409 otherwise. 403 outside the hacking window.",
      },
    },
    async (req) => deleteMyProject(req.userId as number, req.params.id),
  );
}
