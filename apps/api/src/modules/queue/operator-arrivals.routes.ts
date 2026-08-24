import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAnyCapability, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { actor } from "./actor.js";
import { acknowledgeOperatorArrival, listOperatorArrivalAcks } from "./operator-arrivals.js";
import { entryIdParam, operatorArrivalAckBody } from "./schemas.js";

/** Shared, low-risk arrival notes for queue operators. */
export function registerOperatorArrivalRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const operate = requireCapability(CAPABILITIES.QUEUE_OPERATE);
  const read = requireAnyCapability(
    CAPABILITIES.QUEUE_OPERATE,
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.JUDGE_PANEL,
  );

  typed.get(
    "/api/queue/operator-arrivals",
    {
      preHandler: read,
      config: {
        routeAccessPolicy: {
          kind: "capability",
          anyOf: [CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.JUDGE_PANEL],
        },
      },
      schema: {
        summary: "List shared queue-operator arrival acknowledgements",
        description:
          "Returns acknowledgements for teams currently called to a waiting area. The view is shared by all queue operators and stale acknowledgements disappear when an entry leaves called.",
      },
    },
    async () => ({ items: await listOperatorArrivalAcks() }),
  );

  typed.post(
    "/api/queue/entries/:entryId/operator-arrival",
    {
      preHandler: [operate, idempotencyGuard],
      config: {
        routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_OPERATE },
      },
      schema: {
        params: entryIdParam,
        body: operatorArrivalAckBody,
        summary: "Acknowledge a team at the waiting-area door",
        description:
          "Records the shared operator note that a called team has arrived at its waiting area. It does not advance or alter the judging queue.",
      },
    },
    async (req) => acknowledgeOperatorArrival(req.params.entryId, actor(req.userId)),
  );
}
