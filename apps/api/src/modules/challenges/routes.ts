import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAnyCapability, requireCapability } from "../../lib/capabilities.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { assertCanEditChallenge, assertCanViewPanel } from "./access.js";
import { challengeIdParam, updateChallengeBody } from "./schemas.js";
import {
  getChallenge,
  listAllChallenges,
  listOwnedChallenges,
  listVersions,
  previewPanel,
  updateChallenge,
} from "./service.js";

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
  r.get(
    "/api/challenges",
    { preHandler: requireAnyCapability(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN) },
    async () => ({ challenges: await listAllChallenges() }),
  );

  // Sponsor rep's own challenges (H44/H46).
  r.get(
    "/api/challenges/mine",
    { preHandler: requireCapability(CAPABILITIES.SPONSOR_PORTAL) },
    async (req) => ({ challenges: await listOwnedChallenges(actor(req.userId)) }),
  );

  r.get("/api/challenges/:id", { schema: { params: challengeIdParam } }, async (req) => {
    await assertCanEditChallenge(req.userId, req.params.id);
    return getChallenge(req.params.id);
  });

  r.patch(
    "/api/challenges/:id",
    { schema: { params: challengeIdParam, body: updateChallengeBody } },
    async (req) => {
      await assertCanEditChallenge(req.userId, req.params.id);
      return updateChallenge(req.params.id, actor(req.userId), req.body);
    },
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
}
