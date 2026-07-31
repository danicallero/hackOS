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
  addRepoChallenge,
  addRepoMember,
  bulkAddRepoChallenge,
  bulkRemoveRepoChallenge,
  confirmImport,
  createMyProject,
  createRepoNative,
  getRepoForScope,
  linkParticipant,
  linkParticipantSecondary,
  listPublicChallenges,
  listReposForScope,
  listUnmatchedParticipants,
  mapPrizeToChallenge,
  myProjects,
  participantsCanCreateProjects,
  previewImport,
  removeDevpostParticipant,
  removeRepoChallenge,
  removeRepoMember,
  removeRepoPrize,
  sendClaimEmail,
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
      return linkParticipant(req.userId as number, repoId, email.toLowerCase(), userId);
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
        description: "Uses the verified-secondary matching path for an imported participant (H17).",
      },
    },
    async (req) => {
      const { repoId, email, userId } = req.body;
      return linkParticipantSecondary(req.userId as number, repoId, email.toLowerCase(), userId);
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
      return sendClaimEmail(req.userId as number, repoId, email.toLowerCase());
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
      removeDevpostParticipant(
        req.userId as number,
        req.params.repoId,
        req.params.email.toLowerCase(),
      ),
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
        summary: "My projects (H20): team roster, challenges and queue status. Read-only.",
        description:
          "Projects the caller belongs to, with team members, challenge lineup and live queue positions. Teammate emails come back as null — only the caller's own address is included. `canCreate` reflects the event's H19 policy AND whether the caller may still create one (they don't belong to a project yet).",
      },
    },
    async (req) => {
      const projects = await myProjects(req.userId as number);
      const policyEnabled = await participantsCanCreateProjects();
      return { projects, canCreate: policyEnabled && projects.length === 0 };
    },
  );

  r.post(
    "/api/me/projects",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        summary: "Create my own project (H19) — only while the event policy allows it.",
        description:
          "403 unless event settings enable participant project creation; 409 if the caller already belongs to a project. The caller becomes the first team member; chosen (publicly visible) challenges enqueue the team at the bottom of their queues. Audited; idempotent via Idempotency-Key.",
        body: createMyProjectBodySchema,
      },
    },
    async (req) => createMyProject(req.userId as number, req.body),
  );
}
