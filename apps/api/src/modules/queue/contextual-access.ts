import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { assertEntryInScope, resolveReviewScope } from "./reviews.js";

type ParamName = "roomId" | "challengeId" | "entryId" | "repoId";

function numberParam(req: FastifyRequest, name: ParamName): number {
  const params = req.params as Partial<Record<ParamName, unknown>>;
  return Number(params[name]);
}

function numberBody(req: FastifyRequest, name: "challengeId"): number {
  return Number((req.body as Partial<Record<typeof name, unknown>>)[name]);
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

async function judgesChallenge(userId: number, challengeId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM room_judges rj
       JOIN room_challenges rc
         ON rc.room_id = rj.room_id
        AND rc.challenge_id = rj.challenge_id
      WHERE rj.user_id = $1 AND rj.challenge_id = $2
      LIMIT 1`,
    [userId, challengeId],
  );
  return rowCount !== 0;
}

/** Room actions are physical operations: assignment to the shared challenge is not enough. */
async function judgesRoom(userId: number, roomId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM room_judges rj
       JOIN room_challenges rc
         ON rc.room_id = rj.room_id
        AND rc.challenge_id = rj.challenge_id
      WHERE rj.user_id = $1 AND rj.room_id = $2
      LIMIT 1`,
    [userId, roomId],
  );
  return rowCount !== 0;
}

async function roomChallengeId(roomId: number): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT challenge_id FROM room_challenges WHERE room_id = $1 LIMIT 1`,
    [roomId],
  );
  return rows[0] ? Number(rows[0].challenge_id) : null;
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
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const roomId = numberParam(req, "roomId");
    if (await judgesRoom(userId, roomId)) return;
    denied("room", { roomId, capabilities });
  };
}

/** Read-only room scope additionally permits the owning sponsor representative. */
export function requireRoomAccessOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const roomId = numberParam(req, "roomId");
    if (await judgesRoom(userId, roomId)) return;
    const challengeId = await roomChallengeId(roomId);
    // H46 ownership remains a read-only sponsor scope; an assigned judge is
    // deliberately bound to the concrete room, even when rooms share a queue.
    if (challengeId != null && (await ownsChallenge(userId, challengeId))) return;
    denied("room", { roomId, capabilities });
  };
}

/** H46 room assignments are global-admin or challenge-owner only. */
export const requireRoomAssignmentsAccess: preHandlerHookHandler = async (req) => {
  const userId = await requireUser(req);
  if (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN, req)) return;
  const roomId = numberParam(req, "roomId");
  const challengeId = await roomChallengeId(roomId);
  if (challengeId != null && (await ownsChallenge(userId, challengeId))) return;
  denied("room assignments", { roomId });
};

export function requireChallengeJudgeOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const challengeId = numberParam(req, "challengeId");
    if (await hasChallengeRelationship(userId, challengeId)) return;
    denied("challenge", { challengeId, capabilities });
  };
}

export function requireRepoJudgeOrCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = await requireUser(req);
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
    if (await hasAnyCapability(req, userId, capabilities)) return;
    const entryId = numberParam(req, "entryId");
    const challengeId = await entryChallengeId(entryId);
    // Sponsor ownership authorizes the sponsor-facing review/export reads, not
    // a judging-panel or queue-transition mutation on an owned challenge.
    if (challengeId != null && (await judgesChallenge(userId, challengeId))) return;
    denied("queue entry", { entryId, capabilities });
  };
}

/** H46 sponsor owners may manage only judges of the room's own challenge. */
export function requireRoomJudgeManager(
  challengeSource: "room" | "params" | "body",
): preHandlerHookHandler {
  return async (req) => {
    const userId = await requireUser(req);
    const roomId = numberParam(req, "roomId");
    const expectedChallengeId = await roomChallengeId(roomId);
    const requestedChallengeId =
      challengeSource === "room"
        ? expectedChallengeId
        : challengeSource === "params"
          ? numberParam(req, "challengeId")
          : numberBody(req, "challengeId");
    // Bind the child challenge to the room before considering any grant: a
    // mismatched parent/child pair must not become a harmless-but-audited
    // no-op mutation, even for QUEUE_ADMIN (AC-2C parent/child isolation).
    if (expectedChallengeId != null && expectedChallengeId !== requestedChallengeId) {
      denied("room judge assignments", { roomId, challengeId: requestedChallengeId });
    }
    // H436: QUEUE_ADMIN bypasses only the "room has no challenge yet" gate below
    // — a global admin may legitimately browse/manage judges before the room's
    // challenge is set, unlike the sponsor-owner fallback which needs a challenge
    // to check ownership of.
    if (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN, req)) return;
    if (expectedChallengeId == null) {
      denied("room judge assignments", { roomId, challengeId: requestedChallengeId });
    }
    if (await ownsChallenge(userId, expectedChallengeId)) {
      return;
    }
    denied("room judge assignments", { roomId, challengeId: requestedChallengeId });
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
  const { rows } = await pool.query(
    `SELECT DISTINCT rc.room_id
       FROM room_challenges rc
       LEFT JOIN room_judges rj ON rj.room_id = rc.room_id AND rj.challenge_id = rc.challenge_id
       LEFT JOIN challenges c ON c.id = rc.challenge_id
       LEFT JOIN sponsors author ON author.id = c.author
       LEFT JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
      WHERE rj.user_id = $1 OR mine.user_id = $1
      ORDER BY rc.room_id ASC`,
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
