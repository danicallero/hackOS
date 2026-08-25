import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { broadcast } from "../../lib/sse.js";
import { resetJudgingData } from "./reset.js";
import { judgingDataResetBody } from "./schemas.js";
import { clearTvOverride } from "./tv.js";

/** Super-admin-only panic reset for the project/import/queue/judging slice. */
export function registerQueueResetRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/api/queue/admin/reset",
    {
      preHandler: [requireCapability(CAPABILITIES.ADMIN_ALL), idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.ADMIN_ALL } },
      schema: {
        summary: "Reset all project, queue, and judging data",
        description:
          "Super-admin-only, irreversible reset for an event recovery. Atomically removes imported and native projects, project memberships and mappings, queue entries and movement history, reviews, judging sessions, winners, judge assignments, and queue routing; clears Devpost mappings; preserves accounts, applications, event settings, challenge definitions, rooms, and the audit trail. Requires the server confirmation phrase and an explicit irreversible-action acknowledgement.",
        body: judgingDataResetBody,
      },
    },
    async (req) => {
      const result = await resetJudgingData(req.userId as number, {
        key: req.idempotency?.key ?? null,
        scope: req.idempotency?.scope ?? null,
      });

      // These are notifications, not the transaction's correctness boundary:
      // all clients refetch their empty projections after the atomic reset.
      await Promise.all([
        broadcast(SSE_TOPICS.QUEUE, EVENTS.DOMAIN_CHANGED, {}),
        broadcast(SSE_TOPICS.PROJECTS, EVENTS.DOMAIN_CHANGED, {}),
        broadcast(SSE_TOPICS.AUDIT, EVENTS.DOMAIN_CHANGED, {}),
      ]);

      // A stale operator TV override can contain a project/team payload. Hand
      // screens back to the timetable/default projection after the reset.
      try {
        await clearTvOverride();
      } catch (err) {
        req.log.error({ err }, "queue-reset: could not clear the TV override");
      }

      return result;
    },
  );
}
