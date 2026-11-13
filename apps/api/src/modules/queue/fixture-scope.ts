import type { Queryable } from "../../db/pool.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import {
  assertActorSide,
  assertFixtureQueueScope,
  inspectFixtureEnterpriseScopeOfQueueGroup,
  inspectFixtureRoomScopesOfQueueGroup,
} from "../../lib/fixture-queue-scope.js";
import { isSyntheticOperator } from "../../lib/fixture-subject-scope.js";

type QueueFixtureMarkers = {
  has_synthetic: boolean;
  has_real: boolean;
  has_entry_marker_mismatch: boolean;
  has_ungrouped_entry?: boolean;
  enterprise_id?: number;
};

/**
 * Resolve the marker for a complete queue group, including every entry's
 * repo marker. Queue transitions lock their entry/group before calling this;
 * keeping this check on that same client makes the boundary transaction-safe.
 */
export async function queueGroupFixtureMarker(
  client: Queryable,
  queueGroupId: number,
): Promise<boolean | null> {
  // The three reads use the same transaction client, so issue them one at a
  // time. Capture errors to preserve the marker-first error order while also
  // ensuring no sibling query outlives the transaction.
  const settle = async <T>(operation: () => Promise<T>) => {
    try {
      return { status: "fulfilled", value: await operation() } as const;
    } catch (reason) {
      return { status: "rejected", reason } as const;
    }
  };
  const markerResult = await settle(() =>
    client.query<QueueFixtureMarkers>(
      `SELECT COALESCE(bool_or(c.is_test_account IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(c.is_test_account IS NOT TRUE), false) AS has_real,
            COALESCE(
              bool_or(
                r.id IS NOT NULL
                AND c.is_test_account IS DISTINCT FROM r.is_test_account
              ),
              false
            ) AS has_entry_marker_mismatch,
            qg.enterprise_id
       FROM queue_group_challenges qgc
       JOIN challenges c ON c.id = qgc.challenge_id
       JOIN queue_groups qg ON qg.id = qgc.queue_group_id
       LEFT JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
       LEFT JOIN repos r ON r.id = qe.repo_id
      WHERE qgc.queue_group_id = $1
      GROUP BY qg.enterprise_id`,
      [queueGroupId],
    ),
  );
  const enterpriseResult = await settle(() =>
    inspectFixtureEnterpriseScopeOfQueueGroup(client, queueGroupId),
  );
  const roomsResult = await settle(() =>
    inspectFixtureRoomScopesOfQueueGroup(client, queueGroupId),
  );

  if (markerResult.status === "rejected") throw markerResult.reason;
  const { rows } = markerResult.value;
  const marker = rows[0];
  // A queue group without a membership row is malformed, just like a group
  // id that was deleted. Never let either case fall through to the real
  // marker (`false`) — callers that carry queue payloads must fail closed.
  if (!marker) return null;
  if (marker?.has_entry_marker_mismatch || (marker?.has_synthetic && marker.has_real)) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "queueGroup",
      resourceId: queueGroupId,
    });
  }
  if (marker && (marker.has_synthetic || marker.has_real)) {
    if (enterpriseResult.status === "rejected") throw enterpriseResult.reason;
    const enterprise = enterpriseResult.value;
    if (
      !enterprise.exists ||
      (enterprise.has_synthetic && enterprise.has_real) ||
      (!enterprise.has_synthetic && !enterprise.has_real) ||
      enterprise.has_synthetic !== marker.has_synthetic
    ) {
      throw new ConflictError("Queue fixture markers must match across the queue graph", {
        code: "review_fixture_scope",
        resource: "queueGroup",
        resourceId: queueGroupId,
      });
    }

    // One set-based inspection for every serving room (same verdict per room
    // as inspectFixtureRoomScope, without a query per room).
    if (roomsResult.status === "rejected") throw roomsResult.reason;
    for (const room of roomsResult.value) {
      if (
        !room.exists ||
        (room.has_synthetic && room.has_real) ||
        (room.has_graph && !room.has_synthetic && !room.has_real) ||
        room.has_synthetic !== marker.has_synthetic
      ) {
        throw new ConflictError("Queue fixture markers must match across the room graph", {
          code: "review_fixture_scope",
          resource: "queueGroup",
          resourceId: queueGroupId,
        });
      }
    }
  }
  return marker?.has_synthetic === true;
}

export type QueueChallengeFixtureScope = {
  challengeId: number;
  queueGroupId: number;
  fixtureMarker: boolean;
};

/**
 * Resolve a challenge's complete queue scope for challenge-only reads.
 *
 * Managed challenges must have one queue-group membership. If malformed data
 * reaches the database, callers must not silently fall back to challenge-only
 * filtering because that can expose a partial or mixed
 * queue. The group marker also validates every member challenge, enterprise,
 * and queued repository before the read proceeds.
 */
async function resolveQueueChallengeScope(
  client: Queryable,
  challengeId: number,
): Promise<QueueChallengeFixtureScope> {
  const { rows } = await client.query<{
    is_test_account: boolean;
    queue_group_id: number | null;
  }>(
    `SELECT c.is_test_account, qgc.queue_group_id
       FROM challenges c
       LEFT JOIN queue_group_challenges qgc ON qgc.challenge_id = c.id
      WHERE c.id = $1`,
    [challengeId],
  );
  const challenge = rows[0];
  if (!challenge) throw new NotFoundError("Challenge not found", { challengeId });
  if (challenge.queue_group_id == null) {
    throw new ConflictError("Challenge has no complete queue-group scope", {
      code: "review_fixture_scope",
      resource: "challenge",
      resourceId: challengeId,
    });
  }

  const fixtureMarker = await queueGroupFixtureMarker(client, Number(challenge.queue_group_id));
  if (fixtureMarker === null || fixtureMarker !== (challenge.is_test_account === true)) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "challenge",
      resourceId: challengeId,
    });
  }
  return {
    challengeId,
    queueGroupId: Number(challenge.queue_group_id),
    fixtureMarker,
  };
}

/** Require a caller-supplied fixture marker to match the complete challenge scope. */
export async function assertQueueChallengeReadScope(
  client: Queryable,
  challengeId: number,
  fixtureMarker: boolean,
): Promise<QueueChallengeFixtureScope> {
  const scope = await resolveQueueChallengeScope(client, challengeId);
  if (scope.fixtureMarker !== fixtureMarker) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "challenge",
      resourceId: challengeId,
    });
  }
  return scope;
}

async function assertRepoFixtureGraph(client: Queryable, repoId: number): Promise<void> {
  const { rows } = await client.query<QueueFixtureMarkers>(
    `SELECT COALESCE(bool_or(c.is_test_account IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(c.is_test_account IS NOT TRUE), false) AS has_real,
            COALESCE(
              bool_or(c.is_test_account IS DISTINCT FROM r.is_test_account),
              false
            ) AS has_entry_marker_mismatch,
            COALESCE(bool_or(qgc.queue_group_id IS NULL), false) AS has_ungrouped_entry
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN repos r ON r.id = qe.repo_id
       LEFT JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
      WHERE qe.repo_id = $1`,
    [repoId],
  );
  const marker = rows[0];
  if (
    marker?.has_ungrouped_entry ||
    marker?.has_entry_marker_mismatch ||
    (marker?.has_synthetic && marker.has_real)
  ) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "repo",
      resourceId: repoId,
    });
  }
}

type ActorMarkerHint = boolean | Promise<boolean>;

/**
 * The actor's synthetic marker as an already-started promise. Callers that
 * hold a request-scoped read pass it as `hint`; otherwise one read is issued
 * here and shared by every check in the assert (previously one per check).
 */
function actorMarker(
  client: Queryable,
  actorId: number,
  hint: ActorMarkerHint | undefined,
): Promise<boolean> {
  const marker = Promise.resolve(hint ?? isSyntheticOperator(client, actorId));
  marker.catch(() => undefined);
  return marker;
}

/**
 * Assert an entry and its complete queue graph are in the actor's marker scope.
 * `actorIsSyntheticHint` lets a request-scoped caller reuse one actor read.
 */
export async function assertQueueEntryScope(
  client: Queryable,
  actorId: number,
  entryId: number,
  actorIsSyntheticHint?: ActorMarkerHint,
): Promise<boolean> {
  // One read serves both the entry-side fixture verdict and the queue-group
  // lookup (they were two reads of the same row). Order of verdicts is kept:
  // entry marker mismatch, actor side, missing group scope, group graph.
  const { rows } = await client.query<{
    challenge_is_test_account: boolean;
    repo_is_test_account: boolean;
    queue_group_id: number | null;
  }>(
    `SELECT c.is_test_account AS challenge_is_test_account,
            r.is_test_account AS repo_is_test_account,
            qgc.queue_group_id
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN repos r ON r.id = qe.repo_id
       LEFT JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
      WHERE qe.id = $1`,
    [entryId],
  );
  const row = rows[0];
  if (row && row.challenge_is_test_account !== row.repo_is_test_account) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      entryId,
    });
  }
  const actorIsSynthetic = await actorMarker(client, actorId, actorIsSyntheticHint);
  assertActorSide(row?.challenge_is_test_account === true, actorIsSynthetic);
  if (row?.queue_group_id == null) {
    throw new ConflictError("Queue entry has no complete queue-group scope", {
      code: "review_fixture_scope",
      resource: "entry",
      resourceId: entryId,
    });
  }
  const groupIsSynthetic = await queueGroupFixtureMarker(client, row.queue_group_id);
  if (groupIsSynthetic === null || groupIsSynthetic !== (row.challenge_is_test_account === true)) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "entry",
      resourceId: entryId,
    });
  }
  return actorIsSynthetic;
}

/** Assert a room's actor marker and every served queue group marker agree. */
export async function assertQueueRoomScope(
  client: Queryable,
  actorId: number,
  roomId: number,
  actorIsSyntheticHint?: ActorMarkerHint,
): Promise<boolean> {
  const actorIsSynthetic = await assertFixtureQueueScope(
    client,
    actorId,
    "room",
    roomId,
    actorIsSyntheticHint,
  );
  const { rows } = await client.query<{ queue_group_id: number }>(
    `SELECT queue_group_id FROM room_queue_groups WHERE room_id = $1`,
    [roomId],
  );
  // Validate serving groups in row order; every query uses the same client.
  let fixtureMarker: boolean | undefined;
  for (const row of rows) {
    const groupMarker = await queueGroupFixtureMarker(client, Number(row.queue_group_id));
    if (groupMarker === null) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        resource: "room",
        resourceId: roomId,
      });
    }
    if (fixtureMarker !== undefined && groupMarker !== fixtureMarker) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        resource: "room",
        resourceId: roomId,
      });
    }
    fixtureMarker = groupMarker;
  }
  return actorIsSynthetic;
}

/** Assert a queue group, including all queued repos, is in actor scope. */
export async function assertQueueGroupScope(
  client: Queryable,
  actorId: number,
  queueGroupId: number,
): Promise<boolean> {
  const actorIsSynthetic = await assertFixtureQueueScope(
    client,
    actorId,
    "queueGroup",
    queueGroupId,
  );
  if ((await queueGroupFixtureMarker(client, queueGroupId)) === null) {
    throw new ConflictError("Queue group has no complete fixture scope", {
      code: "review_fixture_scope",
      resource: "queueGroup",
      resourceId: queueGroupId,
    });
  }
  return actorIsSynthetic;
}

/** Assert a challenge and its queue group are in actor scope. */
export async function assertQueueChallengeScope(
  client: Queryable,
  actorId: number,
  challengeId: number,
  actorIsSyntheticHint?: ActorMarkerHint,
): Promise<boolean> {
  const actorIsSynthetic = await assertFixtureQueueScope(
    client,
    actorId,
    "challenge",
    challengeId,
    actorIsSyntheticHint,
  );
  const scope = await resolveQueueChallengeScope(client, challengeId);
  if (scope.fixtureMarker !== actorIsSynthetic) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "challenge",
      resourceId: challengeId,
    });
  }
  return actorIsSynthetic;
}

/** Assert a repo and every queue entry referencing it are in actor scope. */
export async function assertQueueRepoScope(
  client: Queryable,
  actorId: number,
  repoId: number,
  actorIsSyntheticHint?: ActorMarkerHint,
): Promise<boolean> {
  const actorIsSynthetic = await assertFixtureQueueScope(
    client,
    actorId,
    "repo",
    repoId,
    actorIsSyntheticHint,
  );
  await assertRepoFixtureGraph(client, repoId);
  const { rows: repoRows } = await client.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM repos WHERE id = $1`,
    [repoId],
  );
  const { rows: groupRows } = await client.query<{ queue_group_id: number }>(
    `SELECT DISTINCT qgc.queue_group_id
       FROM queue_entries qe
       JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
      WHERE qe.repo_id = $1`,
    [repoId],
  );
  const repoMarker = repoRows[0]?.is_test_account === true;
  for (const row of groupRows) {
    const groupMarker = await queueGroupFixtureMarker(client, Number(row.queue_group_id));
    if (groupMarker === null || groupMarker !== repoMarker) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        resource: "repo",
        resourceId: repoId,
      });
    }
  }
  return actorIsSynthetic;
}
