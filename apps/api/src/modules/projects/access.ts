import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import type {
  ContextualPolicyResolver,
  ContextualResourceLocator,
} from "../../lib/route-policy.js";

export interface RepositoryResource {
  id: number;
}

/** The exact challenge scope granted by project read access (H44/H46). */
export interface RepositoryAccessScope {
  fullAccess: boolean;
  challengeIds: number[];
}

const scopes = new WeakMap<FastifyRequest, RepositoryAccessScope>();

function repoIdFrom(request: FastifyRequest, locator: ContextualResourceLocator): number {
  const source = request[locator.source] as Record<string, unknown> | undefined;
  return Number(source?.[locator.field]);
}

/**
 * Central H20/H44/H46 project scope. `projects:read` (including `*`) is
 * global; relationship access remains only the caller's assigned/owned
 * challenges and never expands to another enterprise or room.
 */
export async function resolveRepositoryAccessScope(
  request: FastifyRequest,
): Promise<RepositoryAccessScope> {
  const userId = request.userId;
  if (userId == null) throw new UnauthorizedError();
  if (await userHasCapability(userId, CAPABILITIES.PROJECTS_READ, request)) {
    return { fullAccess: true, challengeIds: [] };
  }

  const [judgeRows, sponsorRows] = await Promise.all([
    pool.query(`SELECT DISTINCT challenge_id FROM room_judges WHERE user_id = $1`, [userId]),
    pool.query(
      `SELECT DISTINCT c.id
         FROM challenges c
         JOIN sponsors author ON author.id = c.author
         JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
        WHERE mine.user_id = $1`,
      [userId],
    ),
  ]);
  const challengeIds = new Set<number>();
  for (const row of judgeRows.rows as Array<{ challenge_id: number }>) {
    challengeIds.add(Number(row.challenge_id));
  }
  for (const row of sponsorRows.rows as Array<{ id: number }>) challengeIds.add(Number(row.id));
  if (challengeIds.size === 0) {
    // A declared judge/sponsor relation grants a valid empty project list;
    // an unrelated authenticated account must still receive a 403.
    const relationship = await pool.query(
      `SELECT 1 FROM sponsors WHERE user_id = $1
       UNION ALL SELECT 1 FROM room_judges WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );
    if (!relationship.rowCount) {
      throw new ForbiddenError(`Missing capability: ${CAPABILITIES.PROJECTS_READ}`);
    }
  }
  return { fullAccess: false, challengeIds: [...challengeIds] };
}

export async function repositoryIdsForScope(scope: RepositoryAccessScope): Promise<number[]> {
  if (scope.fullAccess || scope.challengeIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT repo_id FROM (
        SELECT repo_id FROM queue_entries WHERE challenge_id = ANY($1::int[])
        UNION
        SELECT rdp.repo_id
          FROM repo_devpost_prizes rdp
          JOIN challenges c ON c.devpost_tags ? rdp.prize
         WHERE c.id = ANY($1::int[])
     ) visible_repos`,
    [scope.challengeIds],
  );
  return rows.map((row: { repo_id: number }) => Number(row.repo_id));
}

export const repositoryAccessPolicy: ContextualPolicyResolver<RepositoryResource> = {
  name: "repository-access",
  async resolve(request, locator) {
    const id = repoIdFrom(request, locator);
    const { rows } = await pool.query(`SELECT id FROM repos WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError(`Repo ${id} not found`);
    return { id: Number(rows[0].id) };
  },
  async authorize(request, repository) {
    const scope = await resolveRepositoryAccessScope(request);
    if (!scope.fullAccess && !(await repositoryIdsForScope(scope)).includes(repository.id)) {
      throw new ForbiddenError("Not allowed to access this project", { repoId: repository.id });
    }
    scopes.set(request, scope);
  },
};

/** Named preHandler for GET /repos; the handler consumes its resolved scope. */
export const requireRepositoryListAccess: preHandlerHookHandler = async (request) => {
  scopes.set(request, await resolveRepositoryAccessScope(request));
};

/** Named preHandler for one repository; it validates the exact resource id. */
export function requireRepositoryAccess(locator: ContextualResourceLocator): preHandlerHookHandler {
  return async (request) => {
    const repository = await repositoryAccessPolicy.resolve(request, locator);
    await repositoryAccessPolicy.authorize(request, repository);
  };
}

export function repositoryScopeFor(request: FastifyRequest): RepositoryAccessScope {
  const scope = scopes.get(request);
  if (!scope)
    throw new Error("Repository access scope missing: requireRepository*Access must run first");
  return scope;
}
