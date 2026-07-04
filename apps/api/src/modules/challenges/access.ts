import { CAPABILITIES } from "@hackos/shared/capabilities";
import { pool } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../lib/errors.js";

/** How a user was allowed to touch a challenge. */
export type ChallengeAccess = "admin" | "owner";

/**
 * True when `userId` is a sponsor rep of the enterprise that owns the
 * challenge. Ownership chain: challenges.author → sponsors.id →
 * sponsors.enterprise_id; the user must hold a sponsor row on that same
 * enterprise (H44: "editar mi reto").
 */
export async function ownsChallenge(userId: number, challengeId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
      WHERE c.id = $1 AND mine.user_id = $2`,
    [challengeId, userId],
  );
  return (rowCount ?? 0) > 0;
}

async function ensureExists(challengeId: number): Promise<void> {
  const { rowCount } = await pool.query(`SELECT 1 FROM challenges WHERE id = $1`, [challengeId]);
  if (rowCount === 0) throw new NotFoundError("Challenge not found", { challengeId });
}

/**
 * H44/H8: editing a challenge (description, prizes, judging panel) is allowed
 * for org admins (QUEUE_ADMIN or SPONSORS_MANAGE) and for sponsor reps
 * (SPONSOR_PORTAL) of the owning enterprise. Challenge existence is public, so
 * a missing challenge 404s before any permission check. Returns how access was
 * granted.
 */
export async function assertCanEditChallenge(
  userId: number | null,
  challengeId: number,
): Promise<ChallengeAccess> {
  if (userId == null) throw new UnauthorizedError();
  await ensureExists(challengeId);

  if (
    (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN)) ||
    (await userHasCapability(userId, CAPABILITIES.SPONSORS_MANAGE))
  ) {
    return "admin";
  }
  if (
    (await userHasCapability(userId, CAPABILITIES.SPONSOR_PORTAL)) &&
    (await ownsChallenge(userId, challengeId))
  ) {
    return "owner";
  }
  throw new ForbiddenError("Not allowed to edit this challenge", { challengeId });
}

/**
 * Previewing the judging panel is available to everyone with edit rights plus
 * the people who will actually judge (JUDGE_PANEL) or run the queue
 * (QUEUE_OPERATE) — H44 lets sponsors "preview the panel before judging".
 */
export async function assertCanViewPanel(
  userId: number | null,
  challengeId: number,
): Promise<void> {
  if (userId == null) throw new UnauthorizedError();
  await ensureExists(challengeId);
  if (
    (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN)) ||
    (await userHasCapability(userId, CAPABILITIES.SPONSORS_MANAGE)) ||
    (await userHasCapability(userId, CAPABILITIES.JUDGE_PANEL)) ||
    (await userHasCapability(userId, CAPABILITIES.QUEUE_OPERATE))
  ) {
    return;
  }
  if (
    (await userHasCapability(userId, CAPABILITIES.SPONSOR_PORTAL)) &&
    (await ownsChallenge(userId, challengeId))
  ) {
    return;
  }
  throw new ForbiddenError("Not allowed to view this panel", { challengeId });
}
