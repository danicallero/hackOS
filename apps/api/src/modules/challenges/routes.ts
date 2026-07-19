import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAnyCapability, requireAuth, userHasCapability } from "../../lib/capabilities.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { assertCanEditChallenge, assertCanViewPanel } from "./access.js";
import {
  bulkVisibilityBody,
  challengeIdParam,
  createChallengeBody,
  publishChallengeBody,
  setWinnerBody,
  updateChallengeBody,
  winnerRankParam,
} from "./schemas.js";
import {
  createChallenge,
  getChallenge,
  listAllChallenges,
  listAssignedJudgeChallenges,
  listOwnedChallenges,
  listVersions,
  previewPanel,
  publishChallenge,
  setChallengesVisibility,
  unpublishChallenge,
  updateChallenge,
} from "./service.js";
import { getChallengeWinners, removeChallengeWinner, setChallengeWinner } from "./winners.js";

function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

/**
 * H44: challenge editing — sponsors build their own judging panel and edit
 * their reto; org admins can do the same. Ownership-sensitive routes check
 * access inside the handler (it depends on the challenge, not just a
 * capability); list routes gate on a plain capability.
 */
export function registerChallengeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Admin-wide list.
  r.get("/api/challenges", { preHandler: requireAuth }, async (req) => {
    const userId = actor(req.userId);
    const canListAll =
      (await userHasCapability(userId, CAPABILITIES.SPONSORS_MANAGE)) ||
      (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN));
    return {
      challenges: canListAll
        ? await listAllChallenges()
        : await listAssignedJudgeChallenges(userId),
    };
  });

  // Admin creates a challenge template bound to an enterprise. It starts hidden;
  // making it visible below reveals it on /api/public/challenges (H45).
  r.post(
    "/api/challenges",
    {
      preHandler: requireAnyCapability(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN),
      schema: { body: createChallengeBody },
    },
    async (req, reply) => {
      const created = await createChallenge(req.body, actor(req.userId));
      reply.code(201);
      return created;
    },
  );

  // Sponsor rep's own challenges (H44/H46).
  r.get("/api/challenges/mine", { preHandler: requireAuth }, async (req) => ({
    challenges: await listOwnedChallenges(actor(req.userId)),
  }));

  r.get("/api/challenges/:id", { schema: { params: challengeIdParam } }, async (req) => {
    await assertCanEditChallenge(req.userId, req.params.id);
    return getChallenge(req.params.id);
  });

  r.patch(
    "/api/challenges/:id",
    { schema: { params: challengeIdParam, body: updateChallengeBody } },
    async (req) => {
      const access = await assertCanEditChallenge(req.userId, req.params.id);
      return updateChallenge(req.params.id, actor(req.userId), req.body, access);
    },
  );

  // Admin bulk visibility flip from the challenges list (H45).
  r.post(
    "/api/challenges/visibility",
    {
      preHandler: requireAnyCapability(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN),
      schema: { body: bulkVisibilityBody },
    },
    async (req) => setChallengesVisibility(req.body.ids, req.body.visible, actor(req.userId)),
  );

  r.post(
    "/api/challenges/:id/publish",
    {
      preHandler: requireAnyCapability(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN),
      schema: { params: challengeIdParam, body: publishChallengeBody },
    },
    async (req) => publishChallenge(req.params.id, actor(req.userId), req.body),
  );

  r.post(
    "/api/challenges/:id/unpublish",
    {
      preHandler: requireAnyCapability(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN),
      schema: { params: challengeIdParam },
    },
    async (req) => unpublishChallenge(req.params.id, actor(req.userId)),
  );

  // Preview the judging panel before it goes live (H44).
  r.get(
    "/api/challenges/:id/panel/preview",
    { schema: { params: challengeIdParam } },
    async (req) => {
      await assertCanViewPanel(req.userId, req.params.id);
      return previewPanel(req.params.id);
    },
  );

  // Version history — "saber qué decía el reto en cualquier momento" (H44).
  r.get("/api/challenges/:id/versions", { schema: { params: challengeIdParam } }, async (req) => {
    await assertCanEditChallenge(req.userId, req.params.id);
    return { versions: await listVersions(req.params.id) };
  });

  // H46: internal winner ranking — same access as editing the challenge
  // (admin or the owning sponsor rep), never public, never other sponsors.
  r.get("/api/challenges/:id/winners", { schema: { params: challengeIdParam } }, async (req) => {
    await assertCanEditChallenge(req.userId, req.params.id);
    return { winners: await getChallengeWinners(req.params.id) };
  });

  r.put(
    "/api/challenges/:id/winners/:rank",
    { preHandler: idempotencyGuard, schema: { params: winnerRankParam, body: setWinnerBody } },
    async (req) => {
      await assertCanEditChallenge(req.userId, req.params.id);
      return setChallengeWinner(actor(req.userId), req.params.id, req.params.rank, req.body.repoId);
    },
  );

  r.delete(
    "/api/challenges/:id/winners/:rank",
    { schema: { params: winnerRankParam } },
    async (req) => {
      await assertCanEditChallenge(req.userId, req.params.id);
      await removeChallengeWinner(actor(req.userId), req.params.id, req.params.rank);
      return { removed: true };
    },
  );
}
