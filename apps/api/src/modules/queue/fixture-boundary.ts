import type { FastifyInstance, FastifyRequest } from "fastify";
import { pool } from "../../db/pool.js";
import { assertFixtureQueueScope } from "../logistics/review-fixture-scope.js";

type Resource = "room" | "entry" | "queueGroup" | "challenge" | "repo";
type Target = { resource: Resource; id: number };

/** Route families whose ids name queue, project or challenge data. */
const BOUNDED_PREFIXES = ["/api/queue/", "/api/repos/", "/api/challenges/", "/api/projects/"];

const FIELD_RESOURCE: Record<string, Resource> = {
  roomId: "room",
  entryId: "entry",
  queueGroupId: "queueGroup",
  challengeId: "challenge",
  repoId: "repo",
};
const LIST_RESOURCE: Record<string, Resource> = {
  roomIds: "room",
  entryIds: "entry",
  queueGroupIds: "queueGroup",
  challengeIds: "challenge",
  repoIds: "repo",
};

/** `/api/<family>/:id` routes name their resource by the family. */
function idResource(url: string): Resource | null {
  if (url.startsWith("/api/repos/:id") || url.startsWith("/api/projects/:id")) return "repo";
  if (url.startsWith("/api/challenges/:id")) return "challenge";
  return null;
}

const positiveInt = (value: unknown): number | null => {
  const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
};

function collect(source: unknown, targets: Target[]): void {
  if (!source || typeof source !== "object") return;
  for (const [field, value] of Object.entries(source)) {
    const single = FIELD_RESOURCE[field];
    if (single) {
      const id = positiveInt(value);
      if (id !== null) targets.push({ resource: single, id });
      continue;
    }
    const list = LIST_RESOURCE[field];
    if (list && Array.isArray(value)) {
      for (const item of value.slice(0, 200)) {
        const id = positiveInt(item);
        if (id !== null) targets.push({ resource: list, id });
      }
    }
  }
}

function targetsOf(req: FastifyRequest, url: string): Target[] {
  const targets: Target[] = [];
  collect(req.params, targets);
  collect(req.query, targets);
  collect(req.body, targets);
  const named = idResource(url);
  const id = positiveInt((req.params as Record<string, unknown> | undefined)?.id);
  if (named && id !== null) targets.push({ resource: named, id });
  return targets;
}

/**
 * Central synthetic-data boundary for every queue, project and challenge route.
 *
 * Each route already scopes its own reads and writes; this guard is the single
 * check that does not depend on that. Before a handler runs (and before body
 * validation, so an incomplete body cannot hide a mismatch) every id the
 * request names, in its path, query or body, must sit on the caller's side of
 * the fixture marker: a synthetic account reaches only fixture data and an
 * ordinary account never reaches fixture data (404). Ids of rows that do not
 * exist pass for ordinary accounts, whose handler answers 404 itself.
 */
export function registerFixtureBoundaryGuard(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    const userId = req.userId;
    if (userId == null) return;
    const url = req.routeOptions.url ?? "";
    if (!BOUNDED_PREFIXES.some((prefix) => url.startsWith(prefix))) return;
    const targets = targetsOf(req, url);
    if (targets.length === 0) return;
    for (const target of targets) {
      await assertFixtureQueueScope(pool, userId, target.resource, target.id);
    }
  });
}
