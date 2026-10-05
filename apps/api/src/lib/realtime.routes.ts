import { CAPABILITIES } from "@hackos/shared/capabilities";
import { REALTIME_LIMITS, REALTIME_SCOPES, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { logisticsTopicForFixture } from "../modules/logistics/active-broadcast.js";
import { isSyntheticOperator } from "../modules/logistics/review-fixture-scope.js";
import { queueTopicForFixture } from "../modules/queue/broadcast.js";
import { assertEntryJudgeAccess } from "../modules/queue/contextual-access.js";
import {
  assertActiveAuthenticatedUser,
  createAuthorizationContext,
  userHasCapability,
} from "./capabilities.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "./errors.js";
import { type SseSubscription, subscribeMany } from "./sse.js";
import { requireScopedRefreshAccess, scopedRefreshTopic } from "./sse-access.js";

const scopeSchema = z.union([
  z.enum([
    REALTIME_SCOPES.PERSONAL,
    REALTIME_SCOPES.QUEUE,
    REALTIME_SCOPES.LOGISTICS,
    REALTIME_SCOPES.EXPORTS,
    REALTIME_SCOPES.PUBLIC_TV,
    REALTIME_SCOPES.PUBLIC_CONTENT,
  ]),
  z.templateLiteral([REALTIME_SCOPES.DOMAIN_PREFIX, scopedRefreshTopic]),
  z
    .string()
    .regex(/^review:[1-9]\d{0,9}$/)
    .refine((scope) => Number(scope.slice(7)) <= 2147483647),
]);
const querySchema = z.object({
  scopes: z
    .string()
    .min(1)
    .max(REALTIME_LIMITS.MAX_QUERY_LENGTH)
    .transform((value) => value.split(","))
    .pipe(z.array(scopeSchema).min(1).max(REALTIME_LIMITS.MAX_SCOPES)),
});

/** Reuse the canonical route guards; scope names never expose broker topics (#892). */
export async function authorizeRealtimeScopes(
  req: FastifyRequest,
  scopes: readonly string[],
): Promise<SseSubscription[]> {
  await assertActiveAuthenticatedUser(req);
  if (req.sessionToken) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sessions WHERE token = $1 AND user_id = $2 AND expires_at > now()`,
      [req.sessionToken, req.userId],
    );
    if (!rowCount) throw new UnauthorizedError();
  }
  // Each check gets a fresh snapshot, including long-lived connection reauthorization.
  const fresh = Object.create(req) as FastifyRequest;
  fresh.authorizationContext = createAuthorizationContext(req.userId);
  const context = fresh.authorizationContext;
  const synthetic = await isSyntheticOperator(pool, req.userId!);
  const requireAny = async (caps: readonly (typeof CAPABILITIES)[keyof typeof CAPABILITIES][]) => {
    for (const cap of caps) if (await userHasCapability(context, cap)) return;
    throw new ForbiddenError("Missing realtime scope capability");
  };
  const subscriptions: SseSubscription[] = [];
  for (const scope of new Set(scopes)) {
    let topic: string;
    switch (scope) {
      case REALTIME_SCOPES.PERSONAL:
        topic = `${SSE_TOPICS.USER_PREFIX}${req.userId}`;
        break;
      case REALTIME_SCOPES.QUEUE:
        await requireAny([
          CAPABILITIES.QUEUE_OPERATE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.JUDGE_PANEL,
        ]);
        topic = queueTopicForFixture(synthetic);
        break;
      case REALTIME_SCOPES.LOGISTICS:
        await requireAny([
          CAPABILITIES.ACCREDIT_SCAN,
          CAPABILITIES.PRESENCE_SCAN,
          CAPABILITIES.ACTIVITY_SCAN,
          CAPABILITIES.LOGISTICS_STATS,
          CAPABILITIES.SCHEDULE_MANAGE,
        ]);
        topic = logisticsTopicForFixture(synthetic);
        break;
      case REALTIME_SCOPES.EXPORTS:
        await requireAny([CAPABILITIES.EXPORTS_RUN]);
        topic = SSE_TOPICS.EXPORTS;
        break;
      case REALTIME_SCOPES.PUBLIC_TV:
        topic = SSE_TOPICS.PUBLIC_TV;
        break;
      case REALTIME_SCOPES.PUBLIC_CONTENT:
        topic = SSE_TOPICS.PUBLIC_CONTENT;
        break;
      default:
        if (scope.startsWith(REALTIME_SCOPES.DOMAIN_PREFIX)) {
          const domain = scopedRefreshTopic.parse(
            scope.slice(REALTIME_SCOPES.DOMAIN_PREFIX.length),
          );
          await requireScopedRefreshAccess(req.userId, domain, context);
          topic = domain === SSE_TOPICS.LOGISTICS ? logisticsTopicForFixture(synthetic) : domain;
        } else if (/^review:[1-9]\d{0,9}$/.test(scope)) {
          const entryId = Number(scope.slice(REALTIME_SCOPES.REVIEW_PREFIX.length));
          await assertEntryJudgeAccess(fresh, entryId);
          topic = `${SSE_TOPICS.QUEUE_REVIEW_PREFIX}${entryId}`;
        } else throw new BadRequestError("Unknown realtime scope");
    }
    subscriptions.push({ topic, scope });
  }
  return subscriptions;
}

export function registerRealtimeRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/api/realtime/stream",
    {
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        querystring: querySchema,
        summary: "Multiplexed authenticated realtime stream",
        description:
          "One SSE connection for up to 16 comma-separated, independently authorized scopes. Personal scope derives the account from the session; review:<entryId> retains contextual judging and fixture guards. Envelopes contain the requested logical topic and a per-topic sequence, never a global resume cursor. No replay: reconnects and gaps require scoped authoritative refetches. Access is rechecked before each delivery batch and every 25 seconds; revocation closes the connection. Legacy endpoints remain supported.",
      },
    },
    async (req, reply) => {
      if (req.url.length > REALTIME_LIMITS.MAX_QUERY_LENGTH)
        throw new BadRequestError("Realtime query too large");
      const subscriptions = await authorizeRealtimeScopes(req, req.query.scopes);
      await subscribeMany(subscriptions, req, reply, async () => {
        const current = await authorizeRealtimeScopes(req, req.query.scopes);
        if (current.some((entry, index) => entry.topic !== subscriptions[index]?.topic)) {
          throw new ForbiddenError("Realtime scope changed");
        }
      });
    },
  );
}
