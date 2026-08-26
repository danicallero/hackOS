import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import type {
  ContextualPolicyResolver,
  ContextualResourceLocator,
} from "../../lib/route-policy.js";

/** How a user was allowed to touch a challenge. */
export type ChallengeAccess = "admin" | "owner" | "assigned_judge";

export interface ChallengeResource {
  id: number;
  enterpriseId: number;
}

const editAccesses = new WeakMap<FastifyRequest, ChallengeAccess>();

function challengeIdFrom(request: FastifyRequest, locator: ContextualResourceLocator): number {
  const source = request[locator.source] as Record<string, unknown> | undefined;
  return Number(source?.[locator.field]);
}

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

/** True when `userId` is an org admin over challenges (QUEUE_ADMIN or SPONSORS_MANAGE). */
export async function isChallengeAdmin(userId: number): Promise<boolean> {
  return (
    (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN)) ||
    (await userHasCapability(userId, CAPABILITIES.SPONSORS_MANAGE))
  );
}

/**
 * H44/H8: editing a challenge (description, prizes, judging panel) is allowed
 * for org admins (QUEUE_ADMIN or SPONSORS_MANAGE) and for sponsor reps of the
 * owning enterprise. Ownership alone grants a rep access — no SPONSOR_PORTAL
 * capability is required, so a rep can always reach their own challenge
 * regardless of what perms they were granted. Challenge existence is public, so
 * a missing challenge 404s before any permission check. Returns how access was
 * granted (the publish-gate on general fields is applied by the service).
 */
export async function assertCanEditChallenge(
  userId: number | null,
  challengeId: number,
): Promise<ChallengeAccess> {
  if (userId == null) throw new UnauthorizedError();
  const { rowCount: activeCount } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  if (!activeCount) throw new UnauthorizedError("This account is closed or being removed");
  await ensureExists(challengeId);

  if (await isChallengeAdmin(userId)) return "admin";
  if (await ownsChallenge(userId, challengeId)) return "owner";
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
  const { rowCount: activeCount } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  if (!activeCount) throw new UnauthorizedError("This account is closed or being removed");
  await ensureExists(challengeId);
  if (
    (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN)) ||
    (await userHasCapability(userId, CAPABILITIES.SPONSORS_MANAGE)) ||
    (await userHasCapability(userId, CAPABILITIES.JUDGE_PANEL)) ||
    (await userHasCapability(userId, CAPABILITIES.QUEUE_OPERATE))
  ) {
    return;
  }
  if (await ownsChallenge(userId, challengeId)) return;
  const assigned = await pool.query(
    `SELECT 1
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN enterprise_judges ej ON ej.enterprise_id = author.enterprise_id
      WHERE ej.user_id = $1 AND c.id = $2
      LIMIT 1`,
    [userId, challengeId],
  );
  if (assigned.rowCount) return;
  throw new ForbiddenError("Not allowed to view this panel", { challengeId });
}

/** H44/H46 resolver: admin access is global; sponsor and judge links are exact. */
export const challengeAccessPolicy: ContextualPolicyResolver<ChallengeResource> = {
  name: "challenge-access",
  async resolve(request, locator) {
    const id = challengeIdFrom(request, locator);
    const { rows } = await pool.query(
      `SELECT c.id, author.enterprise_id
         FROM challenges c JOIN sponsors author ON author.id = c.author
        WHERE c.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError("Challenge not found", { challengeId: id });
    return { id: Number(rows[0].id), enterpriseId: Number(rows[0].enterprise_id) };
  },
  async authorize(request, challenge) {
    await assertCanViewPanel(request.userId, challenge.id);
  },
};

/** Contextual edit guard: assigned judges may view, never alter, a challenge. */
export function requireChallengeEdit(locator: ContextualResourceLocator): preHandlerHookHandler {
  return async (request) => {
    const challenge = await challengeAccessPolicy.resolve(request, locator);
    editAccesses.set(request, await assertCanEditChallenge(request.userId, challenge.id));
  };
}

export function challengeEditAccessFor(request: FastifyRequest): ChallengeAccess {
  const result = editAccesses.get(request);
  if (!result)
    throw new Error("Challenge edit access missing: requireChallengeEdit must run first");
  return result;
}

/** Contextual read guard for panel/read-only challenge resources. */
export function requireChallengeAccess(locator: ContextualResourceLocator): preHandlerHookHandler {
  return async (request) => {
    const challenge = await challengeAccessPolicy.resolve(request, locator);
    await challengeAccessPolicy.authorize(request, challenge);
  };
}

/** Directory access is limited to global admins, a sponsor relationship, or an assigned judge. */
export const requireChallengeListAccess: preHandlerHookHandler = async (request) => {
  if (request.userId == null) throw new UnauthorizedError();
  const { rowCount: activeCount } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [request.userId],
  );
  if (!activeCount) throw new UnauthorizedError("This account is closed or being removed");
  if (await isChallengeAdmin(request.userId)) return;
  const relationship = await pool.query(
    `SELECT 1 FROM sponsors WHERE user_id = $1
     UNION ALL SELECT 1 FROM enterprise_judges WHERE user_id = $1
     LIMIT 1`,
    [request.userId],
  );
  if (!relationship.rowCount) throw new ForbiddenError("Not allowed to list challenges");
};
