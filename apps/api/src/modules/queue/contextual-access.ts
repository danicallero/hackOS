import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool } from "../../db/pool.js";
import { getRequestAuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { fixtureRoomIds } from "../logistics/review-fixture-scope.js";
import {
  assertQueueChallengeScope,
  assertQueueEntryScope,
  assertQueueRepoScope,
  assertQueueRoomScope,
} from "./fixture-scope.js";
import { assertEntryInScope, markEntryScopeVerified, resolveReviewScope } from "./reviews.js";

type ParamName = "roomId" | "challengeId" | "entryId" | "repoId";

function numberParam(req: FastifyRequest, name: ParamName): number {
  const params = req.params as Partial<Record<ParamName, unknown>>;
  return Number(params[name]);
}

async function requireUser(req: FastifyRequest): Promise<number> {
  if (req.userId == null) throw new UnauthorizedError();
  return req.userId;
}

async function hasAnyCapability(
  req: FastifyRequest,
  capabilities: readonly Capability[],
): Promise<boolean> {
  const context = getRequestAuthorizationContext(req);
  for (const capability of capabilities) {
    if (await userHasCapability(context, capability)) return true;
  }
  return false;
}

/**
 * A judge belongs to an enterprise roster (`enterprise_judges`), while a
 * sponsor representative judges their own enterprise by default. Judging a
 * challenge therefore means belonging to its enterprise through either link.
 */
async function judgesChallenge(userId: number, challengeId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       LEFT JOIN enterprise_judges ej
              ON ej.enterprise_id = author.enterprise_id AND ej.user_id = $1
       LEFT JOIN sponsors mine
              ON mine.enterprise_id = author.enterprise_id AND mine.user_id = $1
      WHERE c.id = $2 AND (ej.user_id = $1 OR mine.user_id = $1)
      LIMIT 1`,
    [userId, challengeId],
  );
  return rowCount !== 0;
}

/**
 * Room actions resolve to the enterprise the room currently judges for
 * (room -> its queue_group -> that group's enterprise). A room with no
 * queue_group assigned grants nobody contextual access.
 */
async function judgesRoomEnterprise(userId: number, roomId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM room_queue_groups rqg
       JOIN queue_groups qg ON qg.id = rqg.queue_group_id
       LEFT JOIN enterprise_judges ej
              ON ej.enterprise_id = qg.enterprise_id AND ej.user_id = $1
       LEFT JOIN sponsors mine
              ON mine.enterprise_id = qg.enterprise_id AND mine.user_id = $1
      WHERE rqg.room_id = $2 AND (ej.user_id = $1 OR mine.user_id = $1)
      LIMIT 1`,
    [userId, roomId],
  );
  return rowCount !== 0;
}

/**
 * The sponsor-rep counterpart of {@link judgesRoomEnterprise}. Ownership is
 * resolved against the room's pool (`room_enterprises`), not its serving
 * queue_group — a room belongs to an enterprise even while serving none of
 * its queues, or none at all.
 */
async function ownsRoomEnterprise(userId: number, roomId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM room_enterprises re
       JOIN sponsors mine ON mine.enterprise_id = re.enterprise_id
      WHERE re.room_id = $2 AND mine.user_id = $1
      LIMIT 1`,
    [userId, roomId],
  );
  return rowCount !== 0;
}

/**
 * Entry-level relationship in ONE query (it used to be entry -> challenge id,
 * then the roster check): the caller belongs to the enterprise of the entry's
 * challenge through the judge roster or as a sponsor representative.
 */
async function judgesEntry(userId: number, entryId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN sponsors author ON author.id = c.author
       LEFT JOIN enterprise_judges ej
              ON ej.enterprise_id = author.enterprise_id AND ej.user_id = $1
       LEFT JOIN sponsors mine
              ON mine.enterprise_id = author.enterprise_id AND mine.user_id = $1
      WHERE qe.id = $2 AND (ej.user_id = $1 OR mine.user_id = $1)
      LIMIT 1`,
    [userId, entryId],
  );
  return rowCount !== 0;
}

/** True when the caller judges or represents ANY challenge queued for the repo, in one query. */
async function judgesRepoChallenge(userId: number, repoId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN sponsors author ON author.id = c.author
       LEFT JOIN enterprise_judges ej
              ON ej.enterprise_id = author.enterprise_id AND ej.user_id = $1
       LEFT JOIN sponsors mine
              ON mine.enterprise_id = author.enterprise_id AND mine.user_id = $1
      WHERE qe.repo_id = $2 AND (ej.user_id = $1 OR mine.user_id = $1)
      LIMIT 1`,
    [userId, repoId],
  );
  return rowCount !== 0;
}

/** The request's memoized actor marker; shared by every scope assert on this request. */
function actorMarker(req: FastifyRequest): Promise<boolean> {
  return getRequestAuthorizationContext(req).actorIsSyntheticOperator;
}

/** Start a lookup now and keep a later rejection from going unhandled if an earlier check throws first. */
function started<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

function denied(resource: string, details: Record<string, unknown> = {}): never {
  throw new ForbiddenError(`Not allowed to access this ${resource}`, details);
}

/**
 * Contextual queue policies (H29-H46). Global capabilities remain global;
 * relationship access is always bound to the loaded target row, never a
 * caller-supplied parent identifier. This deliberately uses the request-local
 * capability resolver rather than module-local recursive group SQL.
 */
export function requireRoomJudgeOrCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    const roomId = numberParam(req, "roomId");
    // Capabilities load beside the fixture-scope assert; the scope verdict is
    // still awaited first, so a scope violation wins over any grant.
    const granted = started(hasAnyCapability(req, capabilities));
    await assertQueueRoomScope(pool, userId, roomId, actorMarker(req));
    if (await granted) return;
    if (await judgesRoomEnterprise(userId, roomId)) return;
    denied("room", { roomId, capabilities });
  };
}

/** Read-only room scope additionally permits the owning sponsor representative. */
export function requireRoomAccessOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    const roomId = numberParam(req, "roomId");
    const granted = started(hasAnyCapability(req, capabilities));
    await assertQueueRoomScope(pool, userId, roomId, actorMarker(req));
    if (await granted) return;
    if (await judgesRoomEnterprise(userId, roomId)) return;
    // H46 ownership remains a read-only sponsor scope; a roster judge reaches
    // every room their enterprise currently judges in.
    if (await ownsRoomEnterprise(userId, roomId)) return;
    denied("room", { roomId, capabilities });
  };
}

/** H46 room assignments are global-admin or challenge-owner only. */
export const requireRoomAssignmentsAccess: preHandlerHookHandler = async (req) => {
  const userId = await requireUser(req);
  const roomId = numberParam(req, "roomId");
  const isAdmin = started(
    userHasCapability(getRequestAuthorizationContext(req), CAPABILITIES.QUEUE_ADMIN),
  );
  await assertQueueRoomScope(pool, userId, roomId, actorMarker(req));
  if (await isAdmin) return;
  if (await ownsRoomEnterprise(userId, roomId)) return;
  denied("room assignments", { roomId });
};

export function requireChallengeJudgeOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    const challengeId = numberParam(req, "challengeId");
    const granted = started(hasAnyCapability(req, capabilities));
    await assertQueueChallengeScope(pool, userId, challengeId, actorMarker(req));
    if (await granted) return;
    if (await judgesChallenge(userId, challengeId)) return;
    denied("challenge", { challengeId, capabilities });
  };
}

export function requireRepoJudgeOrCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    const repoId = numberParam(req, "repoId");
    const granted = started(hasAnyCapability(req, capabilities));
    await assertQueueRepoScope(pool, userId, repoId, actorMarker(req));
    if (await granted) return;
    if (await judgesRepoChallenge(userId, repoId)) return;
    denied("repo's queue entries", { repoId, capabilities });
  };
}

export function requireEntryJudgeOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    await assertEntryJudgeAccess(req, numberParam(req, "entryId"), capabilities);
  };
}

const accessibleRoomIdsByRequest = new WeakMap<FastifyRequest, Promise<number[] | null>>();

/**
 * Lists are centrally filtered; an association never turns into global room
 * access. Computed once per request: the list guard and the handler share it.
 */
export function accessibleRoomIds(req: FastifyRequest): Promise<number[] | null> {
  let result = accessibleRoomIdsByRequest.get(req);
  if (!result) {
    result = loadAccessibleRoomIds(req);
    accessibleRoomIdsByRequest.set(req, result);
  }
  return result;
}

async function loadAccessibleRoomIds(req: FastifyRequest): Promise<number[] | null> {
  const userId = await requireUser(req);
  const context = getRequestAuthorizationContext(req);
  const [scopedRoomIds, isOperator, isAdmin] = await Promise.all([
    fixtureRoomIds(pool, userId, context.actorIsSyntheticOperator),
    userHasCapability(context, CAPABILITIES.QUEUE_OPERATE),
    userHasCapability(context, CAPABILITIES.QUEUE_ADMIN),
  ]);
  if (isOperator || isAdmin) return scopedRoomIds;
  if (scopedRoomIds.length === 0) return [];
  // Every room linked to a queue_group whose enterprise this user judges for
  // or reps — the room's enterprise is now read straight off the group, with
  // no challenge hop.
  const { rows } = await pool.query(
    `SELECT DISTINCT rqg.room_id
       FROM room_queue_groups rqg
       JOIN queue_groups qg ON qg.id = rqg.queue_group_id
       LEFT JOIN enterprise_judges ej
              ON ej.enterprise_id = qg.enterprise_id AND ej.user_id = $1
       LEFT JOIN sponsors mine ON mine.enterprise_id = qg.enterprise_id
      WHERE (ej.user_id = $1 OR mine.user_id = $1)
        AND rqg.room_id = ANY($2::int[])
      ORDER BY rqg.room_id ASC`,
    [userId, scopedRoomIds],
  );
  return rows.map((row: { room_id: number }) => row.room_id);
}

export const requireRoomListAccess: preHandlerHookHandler = async (req) => {
  const roomIds = await accessibleRoomIds(req);
  if (roomIds !== null && roomIds.length === 0) {
    // Global queue admins/operators still need to reach the empty-state
    // administration screen so they can create the first room. Contextual
    // callers with no relationship remain denied rather than receiving an
    // indistinguishable empty list.
    const context = getRequestAuthorizationContext(req);
    if (
      (await userHasCapability(context, CAPABILITIES.QUEUE_ADMIN)) ||
      (await userHasCapability(context, CAPABILITIES.QUEUE_OPERATE))
    ) {
      return;
    }
    denied("queue rooms");
  }
};

/** H40: export requires the export capability plus global or target relationship scope. */
export function requireChallengeExport(): preHandlerHookHandler {
  return async (req) => {
    const userId = await requireUser(req);
    if (
      !(await userHasCapability(getRequestAuthorizationContext(req), CAPABILITIES.JUDGING_EXPORT))
    ) {
      denied("challenge export", { capability: CAPABILITIES.JUDGING_EXPORT });
    }
    await assertQueueChallengeScope(
      pool,
      userId,
      numberParam(req, "challengeId"),
      actorMarker(req),
    );
    if (
      (await hasAnyCapability(req, [CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.PROJECTS_READ])) ||
      (await judgesChallenge(userId, numberParam(req, "challengeId")))
    ) {
      return;
    }
    denied("challenge export", { challengeId: numberParam(req, "challengeId") });
  };
}

/** H46 review lists/details/exports use the same sponsor-or-admin scope. */
export const requireReviewScopeAccess: preHandlerHookHandler = async (req) => {
  const userId = await requireUser(req);
  const scope = started(resolveReviewScope(getRequestAuthorizationContext(req)));
  const query = req.query as Partial<{ challengeId: number; roomId: number }>;
  const marker = actorMarker(req);
  // Scope-violation verdicts keep their original precedence over the review
  // audience check: resolve the scope (Forbidden for outsiders) first, as
  // before, then validate the filters.
  await scope;
  if (query.challengeId != null) {
    await assertQueueChallengeScope(pool, userId, query.challengeId, marker);
  }
  if (query.roomId != null) {
    await assertQueueRoomScope(pool, userId, query.roomId, marker);
  }
};

export const requireReviewEntryAccess: preHandlerHookHandler = async (req) => {
  const userId = await requireUser(req);
  const entryId = numberParam(req, "entryId");
  const scope = started(resolveReviewScope(getRequestAuthorizationContext(req)));
  // Fixture-graph verdict first (as before), then the review audience check.
  await assertQueueEntryScope(pool, userId, entryId, actorMarker(req));
  const resolved = await scope;
  // The graph assert above is this request's authoritative check; do not repeat it.
  markEntryScopeVerified(resolved, entryId);
  await assertEntryInScope(resolved, entryId);
};

/** Shared contextual authorization for HTTP and multiplexed entry subscriptions (#892). */
export async function assertEntryJudgeAccess(
  req: FastifyRequest,
  entryId: number,
  capabilities: readonly Capability[] = [CAPABILITIES.JUDGE_PANEL],
): Promise<void> {
  const userId = await requireUser(req);
  const granted = started(hasAnyCapability(req, capabilities));
  await assertQueueEntryScope(pool, userId, entryId, actorMarker(req));
  if (await granted) return;
  // Sponsor representatives judge their own enterprise by default; external
  // judges reach the same scope through the enterprise roster.
  if (await judgesEntry(userId, entryId)) return;
  denied("queue entry", { entryId, capabilities });
}
