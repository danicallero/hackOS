import type { Queryable } from "../../db/pool.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";

/**
 * Synthetic App Store/QA operators are deliberately narrower than ordinary
 * capability holders. Their credentials may exercise the operational flows,
 * but only against synthetic subjects. This keeps a reviewer deployment safe
 * even if it is accidentally seeded with real event data.
 */
export async function isSyntheticOperator(db: Queryable, actorId: number): Promise<boolean> {
  const { rows } = await db.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM users WHERE id = $1`,
    [actorId],
  );
  return rows[0]?.is_test_account === true;
}

/**
 * Enforce the synthetic-operator boundary for a subject-targeted operation.
 * Ordinary event operators cannot discover synthetic subjects through a stale
 * id; the dedicated synthetic operator is restricted to synthetic subjects.
 */
export async function assertFixtureSubjectScope(
  db: Queryable,
  actorId: number,
  subjectUserId: number,
): Promise<void> {
  const { rows } = await db.query<{
    actor_is_test_account: boolean;
    subject_is_test_account: boolean;
  }>(
    `SELECT actor.is_test_account AS actor_is_test_account,
            subject.is_test_account AS subject_is_test_account
       FROM users actor
       JOIN users subject ON subject.id = $2
      WHERE actor.id = $1`,
    [actorId, subjectUserId],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("User not found");
  if (row?.actor_is_test_account && !row.subject_is_test_account) {
    throw new ForbiddenError("Review fixture operators may only act on test accounts", {
      code: "review_fixture_scope",
    });
  }
  if (row && !row.actor_is_test_account && row.subject_is_test_account) {
    throw new NotFoundError("User not found");
  }
}

/** Return a safe SQL fragment for a global operational read. */
export async function fixtureReadFilter(
  db: Queryable,
  actorId: number | undefined,
  alias: string,
): Promise<string> {
  if (actorId == null) return "";
  const syntheticOperator = await isSyntheticOperator(db, actorId);
  return ` AND ${alias}.is_test_account = ${syntheticOperator ? "true" : "false"}`;
}

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

/** Return only rooms in the authenticated operator's fixture boundary. */
export async function fixtureRoomIds(db: Queryable, actorId: number): Promise<number[]> {
  const actorIsSynthetic = await isSyntheticOperator(db, actorId);
  const { rows } = await db.query<{ room_id: number }>(
    `${ROOM_MARKERS_CTE}, room_scopes AS (
       SELECT r.id AS room_id,
              EXISTS (
                SELECT 1 FROM room_enterprises re WHERE re.room_id = r.id
                UNION ALL
                SELECT 1 FROM room_queue_groups rqg WHERE rqg.room_id = r.id
              ) AS has_graph,
              COALESCE(bool_or(rm.marker IS TRUE), false) AS has_synthetic,
              COALESCE(bool_or(rm.marker IS FALSE), false) AS has_real
         FROM rooms r
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
  if (marker.has_synthetic && marker.has_real) {
    throw new ConflictError("Fixture markers must match across an enterprise graph", {
      code: "review_fixture_scope",
      enterpriseId,
    });
  }
  const isSynthetic = marker.has_synthetic;
  const actorIsSynthetic = await isSyntheticOperator(db, actorId);
  if (isSynthetic !== actorIsSynthetic) {
    if (actorIsSynthetic) {
      throw new ForbiddenError("Synthetic operators may only access synthetic enterprise data.", {
        code: "review_fixture_scope",
      });
    }
    throw new NotFoundError("Enterprise not found");
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
): Promise<void> {
  let isSynthetic = false;
  if (resource === "challenge" || resource === "repo") {
    const table = resource === "challenge" ? "challenges" : "repos";
    const { rows } = await db.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM ${table} WHERE id = $1`,
      [resourceId],
    );
    isSynthetic = rows[0]?.is_test_account === true;
  } else if (resource === "entry") {
    const { rows } = await db.query<{
      challenge_is_test_account: boolean;
      repo_is_test_account: boolean;
    }>(
      `SELECT c.is_test_account AS challenge_is_test_account,
              r.is_test_account AS repo_is_test_account
         FROM queue_entries qe
         JOIN challenges c ON c.id = qe.challenge_id
         JOIN repos r ON r.id = qe.repo_id
        WHERE qe.id = $1`,
      [resourceId],
    );
    const row = rows[0];
    if (row && row.challenge_is_test_account !== row.repo_is_test_account) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        entryId: resourceId,
      });
    }
    isSynthetic = row?.challenge_is_test_account === true;
  } else {
    if (resource === "queueGroup") {
      const { rows } = await db.query<{ has_synthetic: boolean; has_real: boolean }>(
        `SELECT COALESCE(bool_or(c.is_test_account), false) AS has_synthetic,
                COALESCE(bool_or(NOT c.is_test_account), false) AS has_real
           FROM queue_group_challenges qgc
           JOIN challenges c ON c.id = qgc.challenge_id
          WHERE qgc.queue_group_id = $1`,
        [resourceId],
      );
      const row = rows[0];
      if (row?.has_synthetic && row.has_real) {
        throw new ConflictError("Queue fixture markers must match", {
          code: "review_fixture_scope",
          resource,
          resourceId,
        });
      }
      isSynthetic = row?.has_synthetic === true;
    } else {
      const marker = await inspectFixtureRoomScope(db, resourceId);
      if (marker.has_synthetic && marker.has_real) {
        throw new ConflictError("Queue fixture markers must match", {
          code: "review_fixture_scope",
          resource,
          resourceId,
        });
      }
      if (marker.has_graph && !marker.has_synthetic && !marker.has_real) {
        throw new ConflictError("Queue fixture markers are missing from the room graph", {
          code: "review_fixture_scope",
          resource,
          resourceId,
        });
      }
      isSynthetic = marker.has_synthetic;
    }
  }
  const actorIsSynthetic = await isSyntheticOperator(db, actorId);
  if (isSynthetic !== actorIsSynthetic) {
    if (actorIsSynthetic) {
      throw new ForbiddenError("Synthetic operators may only access synthetic queue data.", {
        code: "review_fixture_scope",
      });
    }
    throw new NotFoundError("Queue resource not found");
  }
}
