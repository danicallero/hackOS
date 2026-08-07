import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { actor } from "./actor.js";
import { enqueueChallenge } from "./service.js";

/** Queue operations dashboard mutations (queue generation for all challenges). */
export function registerOperationsRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/api/queue/challenges/enqueue-all",
    {
      preHandler: [requireCapability(CAPABILITIES.QUEUE_ADMIN), idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: {
        summary: "Generate queue entries for all eligible challenges",
        description:
          "Administrative, idempotent queue generation for every challenge with Devpost tags. Existing queue entries are preserved and reported rather than duplicated.",
      },
    },
    async (req) => {
      const actorId = actor(req.userId);

      const { rows: challenges } = await pool.query(
        `SELECT id, devpost_tags FROM challenges ORDER BY id`,
      );
      const eligible = challenges.filter(
        (challenge: { id: number; devpost_tags?: string[] | null }) =>
          (challenge.devpost_tags?.length ?? 0) > 0,
      );

      const perChallenge: Array<{
        challengeId: number;
        inserted: number;
        alreadyQueued: number;
      }> = [];
      let inserted = 0;
      let alreadyQueued = 0;

      for (const challenge of eligible) {
        const result = await enqueueChallenge(challenge.id, actorId);
        perChallenge.push({
          challengeId: challenge.id,
          inserted: result.inserted.length,
          alreadyQueued: result.alreadyQueued.length,
        });
        inserted += result.inserted.length;
        alreadyQueued += result.alreadyQueued.length;
      }

      return { challenges: perChallenge, inserted, alreadyQueued };
    },
  );
}
