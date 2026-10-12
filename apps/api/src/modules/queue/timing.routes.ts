import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { broadcastQueueEvent } from "./broadcast.js";
import { requireChallengeJudgeOrCapability } from "./contextual-access.js";
import { assertQueueChallengeScope } from "./fixture-scope.js";
import { notifyChallengeQueueChanged } from "./notify.js";

const params = z.object({ challengeId: z.coerce.number().int().positive() });
const access = {
  config: {
    routeAccessPolicy: {
      kind: "contextual" as const,
      policy: "challenge-access",
      resource: { source: "params" as const, field: "challengeId" },
    },
  },
  preHandler: requireChallengeJudgeOrCapability(
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.CHALLENGES_MANAGE,
  ),
};
export function registerTimingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/queue/challenges/:challengeId/timing",
    {
      ...access,
      schema: {
        params,
        summary: "Read track judging timing",
        description:
          "Track target and room preparation allowance, recent observed averages and the learned cycle estimate shared by serving rooms (H32/H38/H39).",
      },
    },
    async (q) => {
      const { rows } = await pool.query(
        `SELECT c.target_seconds_per_team AS "targetSeconds",c.preparation_seconds AS "preparationSeconds",t.* FROM challenges c JOIN queue_group_challenges qgc ON qgc.challenge_id=c.id CROSS JOIN LATERAL queue_group_timing(qgc.queue_group_id) t WHERE c.id=$1`,
        [q.params.challengeId],
      );
      return rows[0];
    },
  );
  r.patch(
    "/api/queue/challenges/:challengeId/timing",
    {
      ...access,
      preHandler: [access.preHandler, idempotencyGuard],
      schema: {
        params,
        body: z.object({
          targetSeconds: z.number().int().min(30).max(7200).nullable(),
          preparationSeconds: z.number().int().min(0).max(1800),
        }),
        summary: "Set track judging timing",
        description:
          "Admins and assigned track judges can adjust the target and preparation allowance before or during judging. Updates ETAs; never alters submitted evaluations or forcibly ends presentations (H32/H39/H53).",
      },
    },
    async (q) => {
      const id = q.params.challengeId;
      await withTransaction(async (db) => {
        await assertQueueChallengeScope(db, q.userId as number, id);
        const before = await db.query(
          `SELECT target_seconds_per_team,preparation_seconds FROM challenges WHERE id=$1 FOR UPDATE`,
          [id],
        );
        await db.query(
          `UPDATE challenges SET target_seconds_per_team=$2,preparation_seconds=$3 WHERE id=$1`,
          [id, q.body.targetSeconds, q.body.preparationSeconds],
        );
        await audit(db, {
          actorId: q.userId,
          entityType: "challenge",
          entityId: id,
          action: "judging_timing",
          before: before.rows[0],
          after: q.body,
          source: "web",
        });
      });
      await broadcastQueueEvent(pool, "challenge", id, EVENTS.QUEUE_ROOM_CHANGED, {
        challengeId: id,
      });
      await notifyChallengeQueueChanged(pool, id);
      return { saved: true };
    },
  );
}
