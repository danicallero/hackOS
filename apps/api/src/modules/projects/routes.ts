import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAnyCapability, requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import type { RouteAccessPolicy } from "../../lib/route-policy.js";
import { listDevpostPrizes } from "../challenges/service.js";
import {
  repositoryScopeFor,
  requireRepositoryAccess,
  requireRepositoryListAccess,
} from "./access.js";
import {
  challengeIdOnlyParamsSchema,
  claimEmailBodySchema,
  createMyProjectBodySchema,
  createRepoBodySchema,
  importCsvBodySchema,
  inviteProjectMemberBodySchema,
  linkParticipantBodySchema,
  mapPrizeBodySchema,
  prizeParamsSchema,
  repoChallengeBodySchema,
  repoChallengeParamsSchema,
  repoDevpostParticipantParamsSchema,
  repoIdParamsSchema,
  repoMemberBodySchema,
  repoMemberParamsSchema,
  repoPrizeParamsSchema,
  updateRepoBodySchema,
} from "./schemas.js";
import {
  acceptProjectInvite,
  addRepoChallenge,
  addRepoMember,
  bulkAddRepoChallenge,
  bulkRemoveRepoChallenge,
  canCreateMyProject,
  confirmImport,
  createMyProject,
  createRepoNative,
  declineProjectInvite,
  deleteMyProject,
  getRepoForScope,
  inviteProjectMember,
  leaveMyProject,
  linkParticipant,
  linkParticipantSecondary,
  listProjectMemberCandidates,
  listPublicChallenges,
  listReposForScope,
  listUnmatchedParticipants,
  mapPrizeToChallenge,
  myPendingInvites,
  myProjects,
  previewImport,
  removeDevpostParticipant,
  removeRepoChallenge,
  removeRepoMember,
  removeRepoPrize,
  sendClaimEmail,
  updateMyProject,
  updateRepo,
} from "./service.js";

/**
 * Projects routes: Devpost intake (H16-H17), the PROJECTS_READ views the
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
    async () => ({ items: await listPublicChallenges() }),
  );

  // Public sponsors live in the sponsors module now: GET /api/public/sponsors
  // reveals enterprises by their OWN visibility window (H45), no longer derived
  // from published challenges.

  // ── H16: import ──────────────────────────────────────────────────────────

  // Pure/read-only preview: parses both CSVs and reports what confirm would do.
  r.post(
    "/api/devpost/imports/preview",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_IMPORT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_IMPORT),
      schema: {
        body: importCsvBodySchema,
        summary: "Preview Devpost import",
        description: "Computes a read-only Devpost import plan (H16).",
      },
    },
    async (req) => previewImport(req.body.projectsCsv, req.body.participantsCsv),
  );

  // Idempotent write; same payload again updates rather than duplicates.
  r.post(
    "/api/devpost/imports/confirm",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_IMPORT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_IMPORT), idempotencyGuard],
      schema: {
        body: importCsvBodySchema,
        summary: "Confirm Devpost import",
        description: "Commits an idempotent Devpost import transaction (H16).",
      },
    },
    async (req) => {
      // requireCapability guarantees userId is set
      return confirmImport(req.userId as number, req.body.projectsCsv, req.body.participantsCsv);
    },
  );

  // ── H17: resolve unmatched participants ──────────────────────────────────

  r.get(
    "/api/devpost/imports/unmatched",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_IMPORT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_IMPORT),
      schema: {
        summary: "List unmatched participants",
        description: "Lists imported Devpost people requiring reconciliation (H17).",
      },
    },
    async () => ({ participants: await listUnmatchedParticipants() }),
  );

  r.post(
    "/api/devpost/imports/link",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_IMPORT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_IMPORT),
      schema: {
        body: linkParticipantBodySchema,
        summary: "Link imported participant",
        description: "Links an imported participant to an account (H17).",
      },
    },
    async (req) => {
      const { repoId, email, userId } = req.body;
      return linkParticipant(req.userId as number, repoId, email, userId);
    },
  );

  // Link an unmatched email to an account by adding it as a verified-secondary
  // (H6): reuses identity's secondary-email verification flow.
  r.post(
    "/api/devpost/imports/link-secondary",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_IMPORT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_IMPORT), idempotencyGuard],
      schema: {
        body: linkParticipantBodySchema,
        summary: "Link participant secondary email",
        description:
          "Starts secondary-email verification for an imported participant; project membership is created only after verification (H6, H17).",
      },
    },
    async (req) => {
      const { repoId, email, userId } = req.body;
      return linkParticipantSecondary(req.userId as number, repoId, email, userId);
    },
  );

  r.post(
    "/api/devpost/imports/claim-email",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_IMPORT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_IMPORT), idempotencyGuard],
      schema: {
        body: claimEmailBodySchema,
        summary: "Send project claim invite",
        description: "Sends an idempotent claim invitation for an imported participant (H17).",
      },
    },
    async (req) => {
      const { repoId, email } = req.body;
      return sendClaimEmail(req.userId as number, repoId, email);
    },
  );

  // ── prize -> challenge mapping helper ─────────────────────────────────────

  r.post(
    "/api/devpost/prizes/:prizeName/map",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_IMPORT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_IMPORT),
      schema: {
        params: prizeParamsSchema,
        body: mapPrizeBodySchema,
        summary: "Map Devpost prize",
        description: "Maps one Devpost prize name to an exact challenge (H16).",
      },
    },
    async (req) =>
      mapPrizeToChallenge(req.userId as number, req.params.prizeName, req.body.challengeId),
  );

  // H17: importers also need this list to see which imported prizes still
  // need mapping on the conflict-resolution screen, not just queue admins.
  r.get(
    "/api/devpost/prizes",
    {
      ...access({
        kind: "capability",
        anyOf: [CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.PROJECTS_IMPORT],
      }),
      preHandler: requireAnyCapability(CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.PROJECTS_IMPORT),
      schema: {
        summary: "List Devpost prizes",
        description: "Lists imported prize names for queue and import operators (H16).",
      },
    },
    async () => ({ prizes: await listDevpostPrizes() }),
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
          "Global project readers see all projects; sponsor representatives and assigned judges see only their exact challenge scope (H20, H46).",
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
        description: "Returns a project only after exact repository authorization (H20, H46).",
      },
    },
    async (req) => getRepoForScope(req.params.id, repositoryScopeFor(req)),
  );

  r.get(
    "/api/projects/member-candidates",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        querystring: z.object({
          q: z.string().trim().min(2),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        summary: "Search project member candidates",
        description:
          "Returns minimal account identity fields for an authorized operator adding a project member (H21).",
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
      users: await listProjectMemberCandidates(req.query.q, req.query.limit),
    }),
  );

  // ── H18: native creation + metadata edits ────────────────────────────────

  r.post(
    "/api/repos",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
      schema: {
        summary: "Create a project natively (H18), no Devpost involved.",
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
        summary: "Edit a project's metadata (H18): name, description, links.",
        description:
          "Updates only the fields present in the body. Team membership and challenge lineup have their own H21 routes. Audited with before/after.",
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

  r.delete(
    "/api/repos/:repoId/devpost-participants/:email",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        params: repoDevpostParticipantParamsSchema,
        summary: "Remove imported project member",
        description: "Detaches an exact imported participant from an exact project (H21).",
      },
    },
    async (req) =>
      removeDevpostParticipant(req.userId as number, req.params.repoId, req.params.email),
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

  r.delete(
    "/api/repos/:repoId/prizes/:prizeName",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.PROJECTS_EDIT }),
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        params: repoPrizeParamsSchema,
        summary: "Remove project prize",
        description: "Removes one exact prize from one exact project (H21).",
      },
    },
    async (req) => removeRepoPrize(req.userId as number, req.params.repoId, req.params.prizeName),
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
  // while the event's H19 policy is on; recorded in docs/challenges-devpost.md.
  // Every mutation here is additionally gated by the hacking window and by
  // "admitted participant" eligibility (assertWithinHackingWindow /
  // isAdmittedParticipant in service.ts).

  r.patch(
    "/api/me/projects/:id",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        params: repoIdParamsSchema,
        body: updateRepoBodySchema,
        summary: "Edit my own project (H19/H20) — active members only.",
        description:
          "Updates only the fields present in the body. 403 if the caller isn't an active member of this project or the hacking window is closed. Audited (source: participant).",
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

  r.get(
    "/api/me/projects/invites",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "My pending project invites (H19/H20).",
        description:
          "Lists project invites addressed to the caller that haven't been accepted or declined yet, newest first.",
      },
    },
    async (req) => ({ invites: await myPendingInvites(req.userId as number) }),
  );

  r.post(
    "/api/me/projects/invites/:id/accept",
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
    "/api/me/projects/invites/:id/decline",
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
          "Deletes the project outright, including its queue entries, judging data and roster. Only allowed when the caller is the project's sole remaining active member; 409 otherwise. 403 outside the hacking window.",
      },
    },
    async (req) => deleteMyProject(req.userId as number, req.params.id),
  );
}
