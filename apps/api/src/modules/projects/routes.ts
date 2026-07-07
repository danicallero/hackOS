import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requireCapability, userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { listDevpostPrizes } from "../challenges/service.js";
import {
  claimEmailBodySchema,
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
} from "./schemas.js";
import {
  addRepoChallenge,
  addRepoMember,
  confirmImport,
  getRepoForUser,
  linkParticipant,
  linkParticipantSecondary,
  listPublicChallenges,
  listReposForUser,
  listUnmatchedParticipants,
  mapPrizeToChallenge,
  myProjects,
  previewImport,
  type RepoScope,
  removeDevpostParticipant,
  removeRepoChallenge,
  removeRepoMember,
  removeRepoPrize,
  sendClaimEmail,
} from "./service.js";

/**
 * Projects / Devpost intake routes (H16-H17 + the PROJECTS_READ views the
 * queue workstream consumes). H21 edit surfaces live here too; H18-H19 remain
 * post-MVP and intentionally absent.
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

  r.get(
    "/api/devpost/prizes",
    { preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN) },
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

  // Participant self-view (minimal H20 read for queue's participant panel).
  r.get("/api/me/projects", { preHandler: requireAuth }, async (req) => ({
    projects: await myProjects(req.userId as number),
  }));
}
