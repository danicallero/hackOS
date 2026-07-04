import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import {
  claimEmailBodySchema,
  importCsvBodySchema,
  linkParticipantBodySchema,
  mapPrizeBodySchema,
  prizeParamsSchema,
  repoIdParamsSchema,
} from "./schemas.js";
import {
  confirmImport,
  getRepo,
  linkParticipant,
  listPublicChallenges,
  listRepos,
  listUnmatchedParticipants,
  mapPrizeToChallenge,
  myProjects,
  previewImport,
  sendClaimEmail,
} from "./service.js";

/**
 * Projects / Devpost intake routes (H16-H17 + the PROJECTS_READ views the
 * queue workstream consumes). H18-H21 are post-MVP and intentionally absent.
 */
export function registerProjectRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const publicChallengeSchema = z.object({
    id: z.number().int(),
    title: z.string(),
    description: z.string(),
    criteria: z.string().nullable(),
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

  // ── PROJECTS_READ views ───────────────────────────────────────────────────

  r.get("/api/repos", { preHandler: requireCapability(CAPABILITIES.PROJECTS_READ) }, async () => ({
    repos: await listRepos(),
  }));

  r.get(
    "/api/repos/:id",
    {
      preHandler: requireCapability(CAPABILITIES.PROJECTS_READ),
      schema: { params: repoIdParamsSchema },
    },
    async (req) => getRepo(req.params.id),
  );

  // Participant self-view (minimal H20 read for queue's participant panel).
  r.get("/api/me/projects", { preHandler: requireAuth }, async (req) => ({
    projects: await myProjects(req.userId as number),
  }));
}
