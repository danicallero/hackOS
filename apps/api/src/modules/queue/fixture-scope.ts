import type { Queryable } from "../../db/pool.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import {
  assertFixtureQueueScope,
  inspectFixtureEnterpriseScope,
  inspectFixtureRoomScope,
  isSyntheticOperator,
} from "../logistics/review-fixture-scope.js";

type QueueFixtureMarkers = {
  has_synthetic: boolean;
  has_real: boolean;
  has_entry_marker_mismatch: boolean;
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
  const { rows } = await client.query<QueueFixtureMarkers>(
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
  );
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
    const enterprise = await inspectFixtureEnterpriseScope(client, Number(marker.enterprise_id));
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

    const { rows: roomRows } = await client.query<{ room_id: number }>(
      `SELECT room_id FROM room_queue_groups WHERE queue_group_id = $1`,
      [queueGroupId],
    );
    for (const roomRow of roomRows) {
      const room = await inspectFixtureRoomScope(client, Number(roomRow.room_id));
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
 * Migration 0410 gives managed challenges one queue-group membership, but a
 * manually deleted group or a legacy row can still leave malformed data in a
 * database. Those rows are not a queue: callers must not silently fall back
 * to challenge-only filtering because that can expose a partial or mixed
 * queue. The group marker also validates every member challenge, enterprise,
 * and queued repository before the read proceeds.
 */
export async function resolveQueueChallengeScope(
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
            ) AS has_entry_marker_mismatch
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN repos r ON r.id = qe.repo_id
      WHERE qe.repo_id = $1`,
    [repoId],
  );
  const marker = rows[0];
  if (marker?.has_entry_marker_mismatch || (marker?.has_synthetic && marker.has_real)) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "repo",
      resourceId: repoId,
    });
  }
}

/** Assert an entry and its complete queue graph are in the actor's marker scope. */
export async function assertQueueEntryScope(
  client: Queryable,
  actorId: number,
  entryId: number,
): Promise<boolean> {
  await assertFixtureQueueScope(client, actorId, "entry", entryId);
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
  if (row?.queue_group_id != null) {
    const groupIsSynthetic = await queueGroupFixtureMarker(client, row.queue_group_id);
    if (
      groupIsSynthetic === null ||
      groupIsSynthetic !== (row.challenge_is_test_account === true)
    ) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        resource: "entry",
        resourceId: entryId,
      });
    }
  }
  return isSyntheticOperator(client, actorId);
}

/** Assert a room's actor marker and every served queue group marker agree. */
export async function assertQueueRoomScope(
  client: Queryable,
  actorId: number,
  roomId: number,
): Promise<boolean> {
  await assertFixtureQueueScope(client, actorId, "room", roomId);
  const { rows } = await client.query<{ queue_group_id: number }>(
    `SELECT queue_group_id FROM room_queue_groups WHERE room_id = $1`,
    [roomId],
  );
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
  return isSyntheticOperator(client, actorId);
}

/** Assert a queue group, including all queued repos, is in actor scope. */
export async function assertQueueGroupScope(
  client: Queryable,
  actorId: number,
  queueGroupId: number,
): Promise<boolean> {
  await assertFixtureQueueScope(client, actorId, "queueGroup", queueGroupId);
  if ((await queueGroupFixtureMarker(client, queueGroupId)) === null) {
    throw new ConflictError("Queue group has no complete fixture scope", {
      code: "review_fixture_scope",
      resource: "queueGroup",
      resourceId: queueGroupId,
    });
  }
  return isSyntheticOperator(client, actorId);
}

/** Assert a challenge and its queue group are in actor scope. */
export async function assertQueueChallengeScope(
  client: Queryable,
  actorId: number,
  challengeId: number,
): Promise<boolean> {
  await assertFixtureQueueScope(client, actorId, "challenge", challengeId);
  const actorMarker = await isSyntheticOperator(client, actorId);
  const scope = await resolveQueueChallengeScope(client, challengeId);
  if (scope.fixtureMarker !== actorMarker) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "challenge",
      resourceId: challengeId,
    });
  }
  return actorMarker;
}

/** Assert a repo and every queue entry referencing it are in actor scope. */
export async function assertQueueRepoScope(
  client: Queryable,
  actorId: number,
  repoId: number,
): Promise<boolean> {
  await assertFixtureQueueScope(client, actorId, "repo", repoId);
  await assertRepoFixtureGraph(client, repoId);
  const { rows: repoRows } = await client.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM repos WHERE id = $1`,
    [repoId],
  );
  const repoMarker = repoRows[0]?.is_test_account === true;
  const { rows: groupRows } = await client.query<{ queue_group_id: number }>(
    `SELECT DISTINCT qgc.queue_group_id
       FROM queue_entries qe
       JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
      WHERE qe.repo_id = $1`,
    [repoId],
  );
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
  return isSyntheticOperator(client, actorId);
}
