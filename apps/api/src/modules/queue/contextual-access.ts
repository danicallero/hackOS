import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool } from "../../db/pool.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

type ParamName = "roomId" | "challengeId" | "entryId" | "repoId";

function numberParam(req: FastifyRequest, name: ParamName): number {
  const params = req.params as Partial<Record<ParamName, unknown>>;
  const value = params[name];
  return typeof value === "number" ? value : Number(value);
}

export async function userIsAssignedJudge(userId: number): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM room_judges WHERE user_id = $1 LIMIT 1`, [
    userId,
  ]);
  return rows.length > 0;
}

async function userHasCapabilityDirect(userId: number, capability: Capability): Promise<boolean> {
  const { rows } = await pool.query(
    `WITH RECURSIVE user_groups AS (
       SELECT group_id FROM permission_group_members WHERE user_id = $1
       UNION
       SELECT gi.child_group_id
       FROM permission_group_includes gi
       JOIN user_groups ug ON ug.group_id = gi.parent_group_id
     )
     SELECT 1
       FROM group_capabilities gc
       JOIN user_groups ug ON ug.group_id = gc.group_id
      WHERE gc.capability IN ($2, $3)
      LIMIT 1`,
    [userId, capability, CAPABILITIES.ADMIN_ALL],
  );
  return rows.length > 0;
}

export async function userCanJudgeRoom(userId: number, roomId: number): Promise<boolean> {
  if (await userHasCapabilityDirect(userId, CAPABILITIES.JUDGE_PANEL)) return true;
  const { rows } = await pool.query(
    `SELECT 1
       FROM room_judges
      WHERE user_id = $1 AND room_id = $2
      LIMIT 1`,
    [userId, roomId],
  );
  return rows.length > 0;
}

export async function userCanJudgeChallenge(userId: number, challengeId: number): Promise<boolean> {
  if (await userHasCapabilityDirect(userId, CAPABILITIES.JUDGE_PANEL)) return true;
  const { rows } = await pool.query(
    `SELECT 1
       FROM room_judges
      WHERE user_id = $1 AND challenge_id = $2
      LIMIT 1`,
    [userId, challengeId],
  );
  return rows.length > 0;
}

export async function userCanJudgeRepo(userId: number, repoId: number): Promise<boolean> {
  if (await userHasCapabilityDirect(userId, CAPABILITIES.JUDGE_PANEL)) return true;
  const { rows } = await pool.query(
    `SELECT 1
       FROM queue_entries qe
       JOIN room_judges rj ON rj.challenge_id = qe.challenge_id AND rj.user_id = $1
      WHERE qe.repo_id = $2
      LIMIT 1`,
    [userId, repoId],
  );
  return rows.length > 0;
}

/**
 * Ownership fallback for sponsor reps (H46): recognizes the challenge's
 * owning enterprise, mirroring assertCanExportChallenge / assertCanReadRoomAssignments.
 */
export async function userOwnsChallenge(userId: number, challengeId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
      WHERE c.id = $1 AND mine.user_id = $2
      LIMIT 1`,
    [challengeId, userId],
  );
  return rows.length > 0;
}

export async function userCanJudgeEntry(userId: number, entryId: number): Promise<boolean> {
  if (await userHasCapabilityDirect(userId, CAPABILITIES.JUDGE_PANEL)) return true;
  const { rows } = await pool.query(
    `SELECT 1
       FROM queue_entries qe
       JOIN room_judges rj ON rj.challenge_id = qe.challenge_id AND rj.user_id = $1
      WHERE qe.id = $2
      LIMIT 1`,
    [userId, entryId],
  );
  return rows.length > 0;
}

async function hasAnyCapability(userId: number, capabilities: Capability[]): Promise<boolean> {
  for (const capability of capabilities) {
    if (await userHasCapabilityDirect(userId, capability)) return true;
  }
  return false;
}

export function requireRoomJudgeOrCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (await hasAnyCapability(req.userId, capabilities)) return;
    if (await userCanJudgeRoom(req.userId, numberParam(req, "roomId"))) return;
    throw new ForbiddenError("Not allowed to access this room", { capabilities });
  };
}

export function requireChallengeJudgeOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (await hasAnyCapability(req.userId, capabilities)) return;
    const challengeId = numberParam(req, "challengeId");
    if (await userCanJudgeChallenge(req.userId, challengeId)) return;
    if (await userOwnsChallenge(req.userId, challengeId)) return;
    throw new ForbiddenError("Not allowed to access this challenge", { capabilities });
  };
}

export function requireRepoJudgeOrCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (await hasAnyCapability(req.userId, capabilities)) return;
    if (await userCanJudgeRepo(req.userId, numberParam(req, "repoId"))) return;
    throw new ForbiddenError("Not allowed to access this repo's challenges", { capabilities });
  };
}

export function requireEntryJudgeOrCapability(
  ...capabilities: Capability[]
): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (await hasAnyCapability(req.userId, capabilities)) return;
    if (await userCanJudgeEntry(req.userId, numberParam(req, "entryId"))) return;
    throw new ForbiddenError("Not allowed to access this queue entry", { capabilities });
  };
}
