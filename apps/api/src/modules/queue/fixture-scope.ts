import type { Queryable } from "../../db/pool.js";
import { ConflictError } from "../../lib/errors.js";
import { assertFixtureQueueScope, isSyntheticOperator } from "../logistics/review-fixture-scope.js";

type QueueFixtureMarkers = {
  has_synthetic: boolean;
  has_real: boolean;
  has_entry_marker_mismatch: boolean;
};

/**
 * Resolve the marker for a complete queue group, including every entry's
 * repo marker. Queue transitions lock their entry/group before calling this;
 * keeping this check on that same client makes the boundary transaction-safe.
 */
async function queueGroupFixtureMarker(client: Queryable, queueGroupId: number): Promise<boolean> {
  const { rows } = await client.query<QueueFixtureMarkers>(
    `SELECT COALESCE(bool_or(c.is_test_account IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(c.is_test_account IS NOT TRUE), false) AS has_real,
            COALESCE(
              bool_or(
                r.id IS NOT NULL
                AND c.is_test_account IS DISTINCT FROM r.is_test_account
              ),
              false
            ) AS has_entry_marker_mismatch
       FROM queue_group_challenges qgc
       JOIN challenges c ON c.id = qgc.challenge_id
       LEFT JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
       LEFT JOIN repos r ON r.id = qe.repo_id
      WHERE qgc.queue_group_id = $1`,
    [queueGroupId],
  );
  const marker = rows[0];
  if (marker?.has_entry_marker_mismatch || (marker?.has_synthetic && marker.has_real)) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      resource: "queueGroup",
      resourceId: queueGroupId,
    });
  }
  return marker?.has_synthetic === true;
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
    if (groupIsSynthetic !== (row.challenge_is_test_account === true)) {
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
  await queueGroupFixtureMarker(client, queueGroupId);
  return isSyntheticOperator(client, actorId);
}

/** Assert a challenge and its queue group are in actor scope. */
export async function assertQueueChallengeScope(
  client: Queryable,
  actorId: number,
  challengeId: number,
): Promise<boolean> {
  await assertFixtureQueueScope(client, actorId, "challenge", challengeId);
  const { rows } = await client.query<{ queue_group_id: number }>(
    `SELECT queue_group_id
       FROM queue_group_challenges
      WHERE challenge_id = $1`,
    [challengeId],
  );
  const actorMarker = await isSyntheticOperator(client, actorId);
  if (rows[0]) {
    const groupMarker = await queueGroupFixtureMarker(client, Number(rows[0].queue_group_id));
    const { rows: challengeRows } = await client.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM challenges WHERE id = $1`,
      [challengeId],
    );
    if (groupMarker !== (challengeRows[0]?.is_test_account === true)) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        resource: "challenge",
        resourceId: challengeId,
      });
    }
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
  return isSyntheticOperator(client, actorId);
}
