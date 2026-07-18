import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import {
  requireAnyCapability,
  requireAuth,
  requireCapability,
  userHasCapability,
} from "../../lib/capabilities.js";
import { ForbiddenError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { listDevpostPrizes } from "../challenges/service.js";
import {
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
  confirmImport,
  createMyProject,
  createRepoNative,
  getRepoForUser,
  linkParticipant,
  linkParticipantSecondary,
  listPublicChallenges,
  listReposForUser,
  listUnmatchedParticipants,
  mapPrizeToChallenge,
  myProjects,
  participantsCanCreateProjects,
  previewImport,
  type RepoScope,
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
/**
 * Who may open Projects (H8, H20, H44/H46): full-access (`projects:read`/`*`),
 * judges (`judge:panel`), and sponsor reps (linked in `sponsors`). Returns the
 * caller's access modes, or null when they hold none (→ 403). Sponsor access is
 * association-based, so it can't be a plain capability guard.
 */
async function resolveRepoScope(userId: number): Promise<RepoScope | null> {
  const [isFullAccess, hasJudgePanel] = await Promise.all([
    userHasCapability(userId, CAPABILITIES.PROJECTS_READ),
    userHasCapability(userId, CAPABILITIES.JUDGE_PANEL),
  ]);
  const isAssignedJudge =
    (await pool.query(`SELECT 1 FROM room_judges WHERE user_id = $1 LIMIT 1`, [userId])).rows
      .length > 0;
  const isJudge = hasJudgePanel || isAssignedJudge;
  const isSponsor =
    (await pool.query(`SELECT 1 FROM sponsors WHERE user_id = $1 LIMIT 1`, [userId])).rows.length >
    0;
  if (!isFullAccess && !isJudge && !isSponsor) return null;
  return { isFullAccess, isJudge, isSponsor };
}

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
    { schema: { response: { 200: z.object({ items: z.array(publicChallengeSchema) }) } } },
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
      preHandler: requireCapability(CAPABILITIES.PROJECTS_IMPORT),
      schema: { body: importCsvBodySchema },
    },
    async (req) => previewImport(req.body.projectsCsv, req.body.participantsCsv),
  );

  // Idempotent write; same payload again updates rather than duplicates.
  r.post(
    "/api/devpost/imports/confirm",
    {
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_IMPORT), idempotencyGuard],
      schema: { body: importCsvBodySchema },
    },
    async (req) => {
      // requireCapability guarantees userId is set
      return confirmImport(req.userId as number, req.body.projectsCsv, req.body.participantsCsv);
    },
  );

  // ── H17: resolve unmatched participants ──────────────────────────────────

  r.get(
    "/api/devpost/imports/unmatched",
    { preHandler: requireCapability(CAPABILITIES.PROJECTS_IMPORT) },
    async () => ({ participants: await listUnmatchedParticipants() }),
  );

  r.post(
    "/api/devpost/imports/link",
    {
      preHandler: requireCapability(CAPABILITIES.PROJECTS_IMPORT),
      schema: { body: linkParticipantBodySchema },
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
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_IMPORT), idempotencyGuard],
      schema: { body: linkParticipantBodySchema },
    },
    async (req) => {
      const { repoId, email, userId } = req.body;
      return linkParticipantSecondary(req.userId as number, repoId, email.toLowerCase(), userId);
    },
  );

  r.post(
    "/api/devpost/imports/claim-email",
    {
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_IMPORT), idempotencyGuard],
      schema: { body: claimEmailBodySchema },
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
      preHandler: requireCapability(CAPABILITIES.PROJECTS_IMPORT),
      schema: { params: prizeParamsSchema, body: mapPrizeBodySchema },
    },
    async (req) =>
      mapPrizeToChallenge(req.userId as number, req.params.prizeName, req.body.challengeId),
  );

  // H17: importers also need this list to see which imported prizes still
  // need mapping on the conflict-resolution screen, not just queue admins.
  r.get(
    "/api/devpost/prizes",
    { preHandler: requireAnyCapability(CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.PROJECTS_IMPORT) },
    async () => ({ prizes: await listDevpostPrizes() }),
  );

  // ── PROJECTS_READ views ───────────────────────────────────────────────────

  // H8/H44/H46: full-access sees all repos; judges/sponsors see only the
  // projects of participants in THEIR challenges (empty list if they have none).
  r.get("/api/repos", { preHandler: requireAuth }, async (req) => {
    const userId = req.userId as number;
    const scope = await resolveRepoScope(userId);
    if (!scope) throw new ForbiddenError(`Missing capability: ${CAPABILITIES.PROJECTS_READ}`);
    return { repos: await listReposForUser(userId, scope) };
  });

  r.get(
    "/api/repos/:id",
    { preHandler: requireAuth, schema: { params: repoIdParamsSchema } },
    async (req) => {
      const userId = req.userId as number;
      const scope = await resolveRepoScope(userId);
      if (!scope) throw new ForbiddenError(`Missing capability: ${CAPABILITIES.PROJECTS_READ}`);
      // Out-of-scope repo -> 404, so a judge/sponsor can't probe existence.
      return getRepoForUser(userId, req.params.id, scope);
    },
  );

  // ── H18: native creation + metadata edits ────────────────────────────────

  r.post(
    "/api/repos",
    {
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
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
      schema: { params: repoMemberParamsSchema.pick({ repoId: true }), body: repoMemberBodySchema },
    },
    async (req) => addRepoMember(req.userId as number, req.params.repoId, req.body.userId),
  );

  r.delete(
    "/api/repos/:repoId/members/:userId",
    {
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: { params: repoMemberParamsSchema },
    },
    async (req) => removeRepoMember(req.userId as number, req.params.repoId, req.params.userId),
  );

  r.delete(
    "/api/repos/:repoId/devpost-participants/:email",
    {
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: { params: repoDevpostParticipantParamsSchema },
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
      preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
      schema: {
        params: repoChallengeParamsSchema.pick({ repoId: true }),
        body: repoChallengeBodySchema,
      },
    },
    async (req) => addRepoChallenge(req.userId as number, req.params.repoId, req.body.challengeId),
  );

  r.delete(
    "/api/repos/:repoId/challenges/:challengeId",
    {
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: { params: repoChallengeParamsSchema },
    },
    async (req) =>
      removeRepoChallenge(req.userId as number, req.params.repoId, req.params.challengeId),
  );

  r.delete(
    "/api/repos/:repoId/prizes/:prizeName",
    {
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: { params: repoPrizeParamsSchema },
    },
    async (req) => removeRepoPrize(req.userId as number, req.params.repoId, req.params.prizeName),
  );

  // ── H19-H20: participant self-view + policy-gated self-creation ──────────

  r.get(
    "/api/me/projects",
    {
      preHandler: requireAuth,
      schema: {
        summary: "My projects (H20): team roster, challenges and queue status. Read-only.",
        description:
          "Projects the caller belongs to, with team members, challenge lineup and live queue positions. `canCreate` reflects the event's H19 policy AND whether the caller may still create one (they don't belong to a project yet).",
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
