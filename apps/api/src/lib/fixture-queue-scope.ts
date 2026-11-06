import type { Queryable } from "../db/pool.js";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.js";
import { isSyntheticOperator } from "./fixture-subject-scope.js";

type FixtureQueueResource = "challenge" | "repo" | "entry" | "room" | "queueGroup";
export type FixtureEnterpriseScope = {
  exists: boolean;
  has_synthetic: boolean;
  has_real: boolean;
};

export type FixtureRoomScope = {
  exists: boolean;
  has_graph: boolean;
  has_synthetic: boolean;
  has_real: boolean;
};

/**
 * A room inherits its fixture marker from both sides of the H46 graph:
 * `room_enterprises` (including the enterprise's sponsors/challenges) and
 * `room_queue_groups` (including the serving group's enterprise and member
 * challenges). Keeping this as one CTE means reads, writes and broadcasts all
 * classify the same room graph, including pooled rooms that serve no queue.
 */
const ROOM_MARKERS_CTE = `
WITH room_markers AS (
  SELECT re.room_id, u.is_test_account AS marker
    FROM room_enterprises re
    JOIN sponsors s ON s.enterprise_id = re.enterprise_id
    JOIN users u ON u.id = s.user_id
  UNION ALL
  SELECT re.room_id, c.is_test_account AS marker
    FROM room_enterprises re
    JOIN sponsors s ON s.enterprise_id = re.enterprise_id
    JOIN challenges c ON c.author = s.id
  UNION ALL
  SELECT rqg.room_id, u.is_test_account AS marker
    FROM room_queue_groups rqg
    JOIN queue_groups qg ON qg.id = rqg.queue_group_id
    JOIN sponsors s ON s.enterprise_id = qg.enterprise_id
    JOIN users u ON u.id = s.user_id
  UNION ALL
  SELECT rqg.room_id, c.is_test_account AS marker
    FROM room_queue_groups rqg
    JOIN queue_groups qg ON qg.id = rqg.queue_group_id
    JOIN sponsors s ON s.enterprise_id = qg.enterprise_id
    JOIN challenges c ON c.author = s.id
  UNION ALL
  SELECT rqg.room_id, c.is_test_account AS marker
    FROM room_queue_groups rqg
    JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
    JOIN challenges c ON c.id = qgc.challenge_id
  UNION ALL
   SELECT rqg.room_id, r.is_test_account AS marker
     FROM room_queue_groups rqg
     JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
     JOIN challenges c ON c.id = qgc.challenge_id
     JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
     JOIN repos r ON r.id = qe.repo_id
    WHERE r.is_test_account = c.is_test_account
)`;

/** Resolve a room's marker from its complete pool/serving graph. */
export async function inspectFixtureRoomScope(
  db: Queryable,
  roomId: number,
): Promise<FixtureRoomScope> {
  const { rows } = await db.query<FixtureRoomScope>(
    `${ROOM_MARKERS_CTE}
     SELECT EXISTS (SELECT 1 FROM rooms WHERE id = $1) AS exists,
            EXISTS (
              SELECT 1 FROM room_enterprises WHERE room_id = $1
              UNION ALL
              SELECT 1 FROM room_queue_groups WHERE room_id = $1
            ) AS has_graph,
            COALESCE(bool_or(marker IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(marker IS NOT TRUE), false) AS has_real
       FROM room_markers
      WHERE room_id = $1`,
    [roomId],
  );
  return rows[0] ?? { exists: false, has_graph: false, has_synthetic: false, has_real: false };
}

/**
 * Set-based {@link inspectFixtureRoomScope}: classify many rooms with one
 * query. Rooms that do not exist are absent from the result.
 */
export async function inspectFixtureRoomScopes(
  db: Queryable,
  roomIds: readonly number[],
): Promise<Map<number, FixtureRoomScope>> {
  if (roomIds.length === 0) return new Map();
  const { rows } = await db.query<FixtureRoomScope & { room_id: number }>(
    `${ROOM_MARKERS_CTE}
     SELECT r.id AS room_id,
            true AS exists,
            EXISTS (
              SELECT 1 FROM room_enterprises WHERE room_id = r.id
              UNION ALL
              SELECT 1 FROM room_queue_groups WHERE room_id = r.id
            ) AS has_graph,
            COALESCE(bool_or(rm.marker IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(rm.marker IS NOT TRUE) FILTER (WHERE rm.room_id IS NOT NULL), false)
              AS has_real
       FROM rooms r
       LEFT JOIN room_markers rm ON rm.room_id = r.id
      WHERE r.id = ANY($1::int[])
      GROUP BY r.id`,
    [roomIds],
  );
  return new Map(
    rows.map((row) => [
      Number(row.room_id),
      {
        exists: true,
        has_graph: row.has_graph,
        has_synthetic: row.has_synthetic,
        has_real: row.has_real,
      },
    ]),
  );
}

/**
 * Classify every room serving one queue group with a single query (the group's
 * room ids are resolved inside the statement, so callers need no prior round
 * trip). Same per-room verdict as {@link inspectFixtureRoomScopes}; a serving
 * link whose room row is missing reports `exists: false`.
 */
export async function inspectFixtureRoomScopesOfQueueGroup(
  db: Queryable,
  queueGroupId: number,
): Promise<FixtureRoomScope[]> {
  const { rows } = await db.query<FixtureRoomScope>(
    `${ROOM_MARKERS_CTE}
     SELECT (r.id IS NOT NULL) AS exists,
            true AS has_graph,
            COALESCE(bool_or(rm.marker IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(rm.marker IS NOT TRUE) FILTER (WHERE rm.room_id IS NOT NULL), false)
              AS has_real
       FROM room_queue_groups rqg
       LEFT JOIN rooms r ON r.id = rqg.room_id
       LEFT JOIN room_markers rm ON rm.room_id = rqg.room_id
      WHERE rqg.queue_group_id = $1
      GROUP BY rqg.room_id, r.id`,
    [queueGroupId],
  );
  return rows;
}

/** Return only rooms in the authenticated operator's fixture boundary. */
export async function fixtureRoomIds(
  db: Queryable,
  actorId: number,
  actorIsSyntheticHint?: boolean | Promise<boolean>,
): Promise<number[]> {
  const actorIsSynthetic = await (actorIsSyntheticHint ?? isSyntheticOperator(db, actorId));
  const { rows } = await db.query<{ room_id: number }>(
    `${ROOM_MARKERS_CTE}, room_graphs AS (
       SELECT room_id FROM room_enterprises
       UNION
       SELECT room_id FROM room_queue_groups
     ), room_scopes AS (
       SELECT r.id AS room_id,
              COUNT(rg.room_id) > 0 AS has_graph,
              COALESCE(bool_or(rm.marker IS TRUE), false) AS has_synthetic,
              COALESCE(bool_or(rm.marker IS FALSE), false) AS has_real
         FROM rooms r
         LEFT JOIN room_graphs rg ON rg.room_id = r.id
         LEFT JOIN room_markers rm ON rm.room_id = r.id
        GROUP BY r.id
     )
     SELECT room_id
       FROM room_scopes
      WHERE ($1::boolean AND has_synthetic AND NOT has_real)
         OR (NOT $1::boolean AND NOT has_synthetic AND (has_real OR NOT has_graph))
      ORDER BY room_id ASC`,
    [actorIsSynthetic],
  );
  return rows.map((row) => Number(row.room_id));
}

const ENTERPRISE_MARKERS_CTE = `
WITH enterprise_markers AS (
  SELECT s.enterprise_id, u.is_test_account AS marker
    FROM sponsors s
    JOIN users u ON u.id = s.user_id
  UNION ALL
  SELECT s.enterprise_id, c.is_test_account AS marker
    FROM sponsors s
    JOIN challenges c ON c.author = s.id
)`;

/** Resolve an enterprise marker without applying actor access policy. */
export async function inspectFixtureEnterpriseScope(
  db: Queryable,
  enterpriseId: number,
): Promise<FixtureEnterpriseScope> {
  const { rows } = await db.query<FixtureEnterpriseScope>(
    `${ENTERPRISE_MARKERS_CTE}
     SELECT EXISTS (SELECT 1 FROM enterprises WHERE id = $1) AS exists,
            COALESCE(bool_or(marker IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(marker IS NOT TRUE), false) AS has_real
       FROM enterprise_markers
      WHERE enterprise_id = $1`,
    [enterpriseId],
  );
  return rows[0] ?? { exists: false, has_synthetic: false, has_real: false };
}

/**
 * {@link inspectFixtureEnterpriseScope} for the enterprise that owns a queue
 * group, resolved inside the statement so it can run beside the group's own
 * marker query. Returns an absent enterprise when the group does not exist.
 */
export async function inspectFixtureEnterpriseScopeOfQueueGroup(
  db: Queryable,
  queueGroupId: number,
): Promise<FixtureEnterpriseScope> {
  const { rows } = await db.query<FixtureEnterpriseScope>(
    `${ENTERPRISE_MARKERS_CTE}
     SELECT EXISTS (SELECT 1 FROM enterprises WHERE id = qg.enterprise_id) AS exists,
            COALESCE(bool_or(em.marker IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(em.marker IS NOT TRUE), false) AS has_real
       FROM queue_groups qg
       LEFT JOIN enterprise_markers em ON em.enterprise_id = qg.enterprise_id
      WHERE qg.id = $1
      GROUP BY qg.id`,
    [queueGroupId],
  );
  return rows[0] ?? { exists: false, has_synthetic: false, has_real: false };
}

/**
 * Pure enterprise rule shared by the single and batch asserts: throws for a
 * mixed graph or an actor on the wrong side of the marker.
 */
function assertEnterpriseMarker(
  marker: FixtureEnterpriseScope,
  actorIsSynthetic: boolean,
  enterpriseId: number,
): void {
  if (marker.has_synthetic && marker.has_real) {
    throw new ConflictError("Fixture markers must match across an enterprise graph", {
      code: "review_fixture_scope",
      enterpriseId,
    });
  }
  if (marker.has_synthetic !== actorIsSynthetic) {
    if (actorIsSynthetic) {
      throw new ForbiddenError("Synthetic operators may only access synthetic enterprise data.", {
        code: "review_fixture_scope",
      });
    }
    throw new NotFoundError("Enterprise not found");
  }
}

/**
 * Check whether an enterprise belongs to the synthetic graph.  Enterprises do
 * not carry their own marker: the marker is inherited from the sponsor user or
 * any challenge owned by one of its sponsors.  A mixed graph is an invariant
 * violation, not a reason to silently pick whichever marker happened to be
 * returned first.
 */
export async function assertFixtureEnterpriseScope(
  db: Queryable,
  actorId: number,
  enterpriseId: number,
): Promise<void> {
  const marker = await inspectFixtureEnterpriseScope(db, enterpriseId);
  assertEnterpriseMarker(marker, await isSyntheticOperator(db, actorId), enterpriseId);
}

/**
 * Set-based {@link assertFixtureEnterpriseScope}: two queries for any number
 * of enterprises. Throws the error of the first offending id in input order;
 * ids that do not exist classify as unmarked, exactly like the single assert.
 */
export async function assertFixtureEnterpriseScopes(
  db: Queryable,
  actorId: number,
  enterpriseIds: readonly number[],
): Promise<void> {
  if (enterpriseIds.length === 0) return;
  const { rows } = await db.query<{
    enterprise_id: number;
    has_synthetic: boolean;
    has_real: boolean;
  }>(
    `${ENTERPRISE_MARKERS_CTE}
     SELECT em.enterprise_id,
            COALESCE(bool_or(em.marker IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(em.marker IS NOT TRUE), false) AS has_real
       FROM enterprise_markers em
      WHERE em.enterprise_id = ANY($1::int[])
      GROUP BY em.enterprise_id`,
    [enterpriseIds],
  );
  const markers = new Map(rows.map((row) => [Number(row.enterprise_id), row]));
  const actorIsSynthetic = await isSyntheticOperator(db, actorId);
  for (const id of enterpriseIds) {
    const row = markers.get(id);
    assertEnterpriseMarker(
      {
        exists: true,
        has_synthetic: row?.has_synthetic ?? false,
        has_real: row?.has_real ?? false,
      },
      actorIsSynthetic,
      id,
    );
  }
}

/**
 * Validate a room-to-enterprise write while the room row is locked by the
 * caller's transaction. A bare room has no fixture marker yet and can be
 * assigned to either boundary; once pooled or serving, changing to the other
 * boundary is rejected before any link is replaced.
 */
export async function assertFixtureRoomEnterpriseScope(
  db: Queryable,
  actorId: number,
  roomId: number,
  enterpriseId: number,
): Promise<void> {
  const room = await inspectFixtureRoomScope(db, roomId);
  if (!room.exists) throw new NotFoundError("Room not found", { roomId });
  if (room.has_synthetic && room.has_real) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "room",
      resourceId: roomId,
    });
  }
  if (room.has_graph && !room.has_synthetic && !room.has_real) {
    throw new ConflictError("Queue fixture markers are missing from the room graph", {
      code: "review_fixture_scope",
      resource: "room",
      resourceId: roomId,
    });
  }

  const enterprise = await inspectFixtureEnterpriseScope(db, enterpriseId);
  if (!enterprise.exists) throw new NotFoundError("Enterprise not found", { enterpriseId });
  if (enterprise.has_synthetic && enterprise.has_real) {
    throw new ConflictError("Fixture markers must match across an enterprise graph", {
      code: "review_fixture_scope",
      enterpriseId,
    });
  }

  const actorIsSynthetic = await isSyntheticOperator(db, actorId);
  const targetIsSynthetic = enterprise.has_synthetic;
  if (targetIsSynthetic !== actorIsSynthetic) {
    if (actorIsSynthetic) {
      throw new ForbiddenError("Synthetic operators may only access synthetic enterprise data.", {
        code: "review_fixture_scope",
      });
    }
    throw new NotFoundError("Enterprise not found", { enterpriseId });
  }

  // No graph means the room is a neutral venue, so the target assignment is
  // what establishes its boundary. Existing graph markers must remain stable.
  if (room.has_graph && room.has_synthetic !== targetIsSynthetic) {
    if (actorIsSynthetic) {
      throw new ForbiddenError("Synthetic operators may only access synthetic room data.", {
        code: "review_fixture_scope",
      });
    }
    throw new NotFoundError("Room not found", { roomId });
  }
}

type EntryScopeRow = { challenge_is_test_account: boolean; repo_is_test_account: boolean };

function entrySynthetic(row: EntryScopeRow | undefined, entryId: number): boolean {
  if (row && row.challenge_is_test_account !== row.repo_is_test_account) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      entryId,
    });
  }
  return row?.challenge_is_test_account === true;
}

function queueGroupSynthetic(
  row: { has_synthetic: boolean; has_real: boolean } | undefined,
  resourceId: number,
): boolean {
  if (row?.has_synthetic && row.has_real) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "queueGroup",
      resourceId,
    });
  }
  return row?.has_synthetic === true;
}

function roomSynthetic(marker: FixtureRoomScope, resourceId: number): boolean {
  if (marker.has_synthetic && marker.has_real) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "room",
      resourceId,
    });
  }
  if (marker.has_graph && !marker.has_synthetic && !marker.has_real) {
    throw new ConflictError("Queue fixture markers are missing from the room graph", {
      code: "review_fixture_scope",
      resource: "room",
      resourceId,
    });
  }
  return marker.has_synthetic;
}

export function assertActorSide(isSynthetic: boolean, actorIsSynthetic: boolean): void {
  if (isSynthetic !== actorIsSynthetic) {
    if (actorIsSynthetic) {
      throw new ForbiddenError("Synthetic operators may only access synthetic queue data.", {
        code: "review_fixture_scope",
      });
    }
    throw new NotFoundError("Queue resource not found");
  }
}

/**
 * Keep synthetic queue/project ids out of global queue capabilities too. A
 * caller who guesses a fixture id must not be able to mutate or inspect it
 * through an ID-based queue route; the dedicated synthetic operator may only
 * reach marked queue data.
 */
export async function assertFixtureQueueScope(
  db: Queryable,
  actorId: number,
  resource: FixtureQueueResource,
  resourceId: number,
  actorIsSyntheticHint?: boolean | Promise<boolean>,
): Promise<void> {
  // The actor marker is independent of the resource lookup, so read it beside
  // it (or reuse the request's memoized read). Verdict order is unchanged:
  // resource-graph errors still surface before the actor-side check.
  const actorIsSynthetic = Promise.resolve(
    actorIsSyntheticHint ?? isSyntheticOperator(db, actorId),
  );
  actorIsSynthetic.catch(() => undefined);
  let isSynthetic = false;
  if (resource === "challenge" || resource === "repo") {
    const table = resource === "challenge" ? "challenges" : "repos";
    const { rows } = await db.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM ${table} WHERE id = $1`,
      [resourceId],
    );
    isSynthetic = rows[0]?.is_test_account === true;
  } else if (resource === "entry") {
    const { rows } = await db.query<EntryScopeRow>(
      `SELECT c.is_test_account AS challenge_is_test_account,
              r.is_test_account AS repo_is_test_account
         FROM queue_entries qe
         JOIN challenges c ON c.id = qe.challenge_id
         JOIN repos r ON r.id = qe.repo_id
        WHERE qe.id = $1`,
      [resourceId],
    );
    isSynthetic = entrySynthetic(rows[0], resourceId);
  } else if (resource === "queueGroup") {
    const { rows } = await db.query<{ has_synthetic: boolean; has_real: boolean }>(
      `SELECT COALESCE(bool_or(c.is_test_account), false) AS has_synthetic,
              COALESCE(bool_or(NOT c.is_test_account), false) AS has_real
         FROM queue_group_challenges qgc
         JOIN challenges c ON c.id = qgc.challenge_id
        WHERE qgc.queue_group_id = $1`,
      [resourceId],
    );
    isSynthetic = queueGroupSynthetic(rows[0], resourceId);
  } else {
    isSynthetic = roomSynthetic(await inspectFixtureRoomScope(db, resourceId), resourceId);
  }
  assertActorSide(isSynthetic, await actorIsSynthetic);
}

/**
 * Set-based {@link assertFixtureQueueScope}: one query per resource kind plus
 * one actor lookup, however many targets. Throws the same error the per-target
 * loop would, for the first offending target in input order.
 */
export async function assertFixtureQueueScopes(
  db: Queryable,
  actorId: number,
  targets: readonly { resource: FixtureQueueResource; id: number }[],
): Promise<void> {
  if (targets.length === 0) return;
  const idsOf = (resource: FixtureQueueResource) => [
    ...new Set(targets.filter((t) => t.resource === resource).map((t) => t.id)),
  ];
  const simple = new Map<string, Map<number, boolean>>();
  for (const [resource, table] of [
    ["challenge", "challenges"],
    ["repo", "repos"],
  ] as const) {
    const ids = idsOf(resource);
    if (ids.length === 0) continue;
    const { rows } = await db.query<{ id: number; is_test_account: boolean }>(
      `SELECT id, is_test_account FROM ${table} WHERE id = ANY($1::int[])`,
      [ids],
    );
    simple.set(resource, new Map(rows.map((r) => [Number(r.id), r.is_test_account === true])));
  }

  const entryIds = idsOf("entry");
  const entryRows = new Map<number, EntryScopeRow>();
  if (entryIds.length > 0) {
    const { rows } = await db.query<EntryScopeRow & { id: number }>(
      `SELECT qe.id,
              c.is_test_account AS challenge_is_test_account,
              r.is_test_account AS repo_is_test_account
         FROM queue_entries qe
         JOIN challenges c ON c.id = qe.challenge_id
         JOIN repos r ON r.id = qe.repo_id
        WHERE qe.id = ANY($1::int[])`,
      [entryIds],
    );
    for (const row of rows) entryRows.set(Number(row.id), row);
  }

  const groupIds = idsOf("queueGroup");
  const groupRows = new Map<number, { has_synthetic: boolean; has_real: boolean }>();
  if (groupIds.length > 0) {
    const { rows } = await db.query<{
      queue_group_id: number;
      has_synthetic: boolean;
      has_real: boolean;
    }>(
      `SELECT qgc.queue_group_id,
              COALESCE(bool_or(c.is_test_account), false) AS has_synthetic,
              COALESCE(bool_or(NOT c.is_test_account), false) AS has_real
         FROM queue_group_challenges qgc
         JOIN challenges c ON c.id = qgc.challenge_id
        WHERE qgc.queue_group_id = ANY($1::int[])
        GROUP BY qgc.queue_group_id`,
      [groupIds],
    );
    for (const row of rows) groupRows.set(Number(row.queue_group_id), row);
  }

  const roomIds = idsOf("room");
  const roomScopes = await inspectFixtureRoomScopes(db, roomIds);
  const actorIsSynthetic = await isSyntheticOperator(db, actorId);

  for (const { resource, id } of targets) {
    let isSynthetic: boolean;
    if (resource === "challenge" || resource === "repo") {
      isSynthetic = simple.get(resource)?.get(id) === true;
    } else if (resource === "entry") {
      isSynthetic = entrySynthetic(entryRows.get(id), id);
    } else if (resource === "queueGroup") {
      isSynthetic = queueGroupSynthetic(groupRows.get(id), id);
    } else {
      isSynthetic = roomSynthetic(
        roomScopes.get(id) ?? {
          exists: false,
          has_graph: false,
          has_synthetic: false,
          has_real: false,
        },
        id,
      );
    }
    assertActorSide(isSynthetic, actorIsSynthetic);
  }
}
