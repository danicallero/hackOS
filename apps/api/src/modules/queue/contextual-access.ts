import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { assertFixtureQueueScope } from "../logistics/review-fixture-scope.js";
import { assertEntryInScope, resolveReviewScope } from "./reviews.js";

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
  userId: number,
  capabilities: readonly Capability[],
): Promise<boolean> {
  for (const capability of capabilities) {
    if (await userHasCapability(userId, capability, req)) return true;
  }
  return false;
}

async function ownsChallenge(userId: number, challengeId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
      WHERE c.id = $1 AND mine.user_id = $2
      LIMIT 1`,
    [challengeId, userId],
  );
  return rowCount !== 0;
}

/**
 * A judge belongs to an enterprise roster (`enterprise_judges`), not to a
 * challenge or a room: judging a challenge means judging for the enterprise
 * that authored it.
 */
async function judgesChallenge(userId: number, challengeId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN enterprise_judges ej ON ej.enterprise_id = author.enterprise_id
      WHERE c.id = $2 AND ej.user_id = $1
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
       JOIN enterprise_judges ej ON ej.enterprise_id = qg.enterprise_id
      WHERE rqg.room_id = $2 AND ej.user_id = $1
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

async function entryChallengeId(entryId: number): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT challenge_id FROM queue_entries WHERE id = $1 LIMIT 1`,
    [entryId],
  );
  return rows[0] ? Number(rows[0].challenge_id) : null;
}

async function repoChallengeIds(repoId: number): Promise<number[]> {
  const { rows } = await pool.query(`SELECT challenge_id FROM queue_entries WHERE repo_id = $1`, [
    repoId,
  ]);
  return rows.map((row: { challenge_id: number }) => row.challenge_id);
}

async function hasChallengeRelationship(userId: number, challengeId: number): Promise<boolean> {
  return (await judgesChallenge(userId, challengeId)) || (await ownsChallenge(userId, challengeId));
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
    await assertFixtureQueueScope(pool, userId, "room", numberParam(req, "roomId"));
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const roomId = numberParam(req, "roomId");
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
    await assertFixtureQueueScope(pool, userId, "room", numberParam(req, "roomId"));
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const roomId = numberParam(req, "roomId");
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
  await assertFixtureQueueScope(pool, userId, "room", numberParam(req, "roomId"));
  if (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN, req)) return;
  const roomId = numberParam(req, "roomId");
  if (await ownsRoomEnterprise(userId, roomId)) return;
  denied("room assignments", { roomId });
};

export function requireChallengeJudgeOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    await assertFixtureQueueScope(pool, userId, "challenge", numberParam(req, "challengeId"));
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const challengeId = numberParam(req, "challengeId");
    if (await hasChallengeRelationship(userId, challengeId)) return;
    denied("challenge", { challengeId, capabilities });
  };
}

export function requireRepoJudgeOrCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    await assertFixtureQueueScope(pool, userId, "repo", numberParam(req, "repoId"));
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const repoId = numberParam(req, "repoId");
    const challengeIds = await repoChallengeIds(repoId);
    if (
      await Promise.all(challengeIds.map((id) => hasChallengeRelationship(userId, id))).then((v) =>
        v.some(Boolean),
      )
    )
      return;
    denied("repo's queue entries", { repoId, capabilities });
  };
}

export function requireEntryJudgeOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    await assertFixtureQueueScope(pool, userId, "entry", numberParam(req, "entryId"));
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const entryId = numberParam(req, "entryId");
    const challengeId = await entryChallengeId(entryId);
    // Sponsor ownership authorizes the sponsor-facing review/export reads, not
    // a judging-panel or queue-transition mutation on an owned challenge.
    if (challengeId != null && (await judgesChallenge(userId, challengeId))) return;
    denied("queue entry", { entryId, capabilities });
  };
}

/** Lists are centrally filtered; an association never turns into global room access. */
export async function accessibleRoomIds(req: FastifyRequest): Promise<number[] | null> {
  const userId = await requireUser(req);
  if (
    (await userHasCapability(userId, CAPABILITIES.QUEUE_OPERATE, req)) ||
    (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN, req))
  ) {
    return null;
  }
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
      WHERE ej.user_id = $1 OR mine.user_id = $1
      ORDER BY rqg.room_id ASC`,
    [userId],
  );
  return rows.map((row: { room_id: number }) => row.room_id);
}

export const requireRoomListAccess: preHandlerHookHandler = async (req) => {
  const roomIds = await accessibleRoomIds(req);
  if (roomIds !== null && roomIds.length === 0) denied("queue rooms");
};

/** H40: export requires the export capability plus global or target relationship scope. */
export function requireChallengeExport(): preHandlerHookHandler {
  return async (req) => {
    const userId = await requireUser(req);
    if (!(await userHasCapability(userId, CAPABILITIES.JUDGING_EXPORT, req))) {
      denied("challenge export", { capability: CAPABILITIES.JUDGING_EXPORT });
    }
    await assertFixtureQueueScope(pool, userId, "challenge", numberParam(req, "challengeId"));
    if (
      (await hasAnyCapability(req, userId, [
        CAPABILITIES.QUEUE_ADMIN,
        CAPABILITIES.PROJECTS_READ,
      ])) ||
      (await hasChallengeRelationship(userId, numberParam(req, "challengeId")))
    ) {
      return;
    }
    denied("challenge export", { challengeId: numberParam(req, "challengeId") });
  };
}

/** H46 review lists/details/exports use the same sponsor-or-admin scope. */
export const requireReviewScopeAccess: preHandlerHookHandler = async (req) => {
  await resolveReviewScope(await requireUser(req));
};

export const requireReviewEntryAccess: preHandlerHookHandler = async (req) => {
  const userId = await requireUser(req);
  await assertEntryInScope(await resolveReviewScope(userId), numberParam(req, "entryId"));
};
