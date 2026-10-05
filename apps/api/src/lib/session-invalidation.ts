import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";
import { broadcast } from "./sse.js";

const positiveId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
};

/** Account facts outside role/enterprise services: snapshot both sides of removals (#892). */
async function targets(req: FastifyRequest): Promise<number[]> {
  const path = req.url.split("?", 1)[0] ?? "";
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ids = new Set<number>();
  const add = (value: unknown) => {
    const id = positiveId(value);
    if (id !== null) ids.add(id);
  };
  const query = async (sql: string, values: unknown[] = []) => {
    const { rows } = await pool.query<{ user_id: number }>(sql, values);
    for (const row of rows) add(row.user_id);
  };
  if (
    /^\/api\/me(?:$|\/)/.test(path) &&
    !/\/(push-tokens|notifications|ui-prefs)(?:$|\/)/.test(path)
  )
    add(req.userId);
  const profile =
    /^\/api\/users\/([1-9]\d*)(?:$|\/(attendee-role|primary-email|anonymize|removal)(?:$|\/))/.exec(
      path,
    );
  if (profile) add(profile[1]);

  const repo =
    /^\/api\/(?:repos|me\/projects)\/([1-9]\d*)(?:$|\/)/.exec(path) ??
    /^\/api\/me\/projects\/invites\/([1-9]\d*)(?:$|\/)/.exec(path);
  if (repo) {
    await query(
      `SELECT user_id FROM submissions WHERE repo_id = $1
      UNION SELECT user_id FROM devpost_participants WHERE repo_id = $1 AND user_id IS NOT NULL`,
      [repo[1]],
    );
  }
  if (path === "/api/repos" || /^\/api\/repos\/\d+\/members$/.test(path)) {
    add(body.userId);
    if (Array.isArray(body.memberUserIds)) for (const id of body.memberUserIds) add(id);
  }
  if (path.startsWith("/api/devpost/")) {
    await query(`SELECT DISTINCT user_id FROM devpost_participants WHERE user_id IS NOT NULL`);
  }

  const response = /^\/api\/responses\/([1-9]\d*)(?:$|\/)/.exec(path);
  if (response)
    await query("SELECT user_id FROM application_responses WHERE id = $1", [response[1]]);
  if (path.startsWith("/api/responses/batch/") && Array.isArray(body.response_ids)) {
    const responseIds = body.response_ids.map(positiveId).filter((id) => id !== null);
    await query("SELECT DISTINCT user_id FROM application_responses WHERE id = ANY($1::int[])", [
      responseIds,
    ]);
  }
  const application = /^\/api\/applications\/([1-9]\d*)(?:$|\/)/.exec(path);
  if (application)
    await query("SELECT DISTINCT user_id FROM application_responses WHERE application_id = $1", [
      application[1],
    ]);

  if (path.startsWith("/api/statistics/access")) {
    const roleId = positiveId(body.role_id) ?? positiveId(path.split("/")[4]);
    if (roleId) await query("SELECT user_id FROM user_roles WHERE role_id = $1", [roleId]);
  }
  if (path === "/api/event" || path === "/api/event/config") {
    await query("SELECT user_id FROM user_event_access");
  }
  return [...ids];
}

/** Existing role and sponsor services retain their explicit, transactional subject snapshots. */
export function registerSessionInvalidations(app: FastifyInstance): void {
  const before = new WeakMap<FastifyRequest, number[]>();
  const isMutation = (req: FastifyRequest) =>
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  app.addHook("preHandler", async (req) => {
    if (!isMutation(req)) return;
    // Best-effort freshness must not replace a business error or block a durable write.
    try {
      before.set(req, await targets(req));
    } catch (error) {
      req.log.warn({ err: error }, "Session target snapshot failed");
    }
  });
  app.addHook("onResponse", async (req, reply) => {
    if (!isMutation(req) || reply.statusCode >= 300 || req.idempotency?.replayed) return;
    try {
      const ids = new Set([...(before.get(req) ?? []), ...(await targets(req))]);
      await Promise.all(
        [...ids].map((id) =>
          broadcast(`${SSE_TOPICS.USER_PREFIX}${id}`, EVENTS.USER_SESSION_CHANGED, {}),
        ),
      );
    } catch (error) {
      req.log.warn({ err: error }, "Session invalidation failed");
    }
  });
}
