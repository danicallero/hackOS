import type pg from "pg";
import { ConflictError } from "../../lib/errors.js";
import { inspectFixtureRoomScope } from "../logistics/review-fixture-scope.js";

type FixtureQueueRow = {
  fixture_key: string;
  slot: string;
  enterprise_id: number | null;
  sponsor_id: number | null;
  challenge_id: number | null;
  repo_id: number | null;
  queue_entry_id: number | null;
  room_id: number | null;
};

const unique = (values: Array<number | null>): number[] => [
  ...new Set(values.filter((value): value is number => value !== null)),
];

/**
 * Remove one account's generated synthetic projects, challenges and queues.
 * Every pointer is checked before destructive work so an accidental registry
 * edit cannot delete a real project or challenge. A mismatch fails the
 * surrounding transaction closed and leaves the fixture available for repair.
 * An account can own several slots (H18); they are purged together because
 * its slots share one enterprise and sponsor.
 */
export async function purgeReviewFixtureQueue(
  client: pg.PoolClient,
  fixtureKey: string,
): Promise<void> {
  const { rows: fixtures } = await client.query<FixtureQueueRow>(
    `SELECT fixture_key, slot, enterprise_id, sponsor_id, challenge_id, repo_id, queue_entry_id,
            room_id
       FROM review_fixture_queues
      WHERE fixture_key = $1
      ORDER BY slot
      FOR UPDATE`,
    [fixtureKey],
  );
  if (fixtures.length === 0) return;
  const repoIds = unique(fixtures.map((fixture) => fixture.repo_id));
  const challengeIds = unique(fixtures.map((fixture) => fixture.challenge_id));
  const entryIds = unique(fixtures.map((fixture) => fixture.queue_entry_id));
  const roomIds = unique(fixtures.map((fixture) => fixture.room_id));
  const sponsorIds = unique(fixtures.map((fixture) => fixture.sponsor_id));
  const enterpriseIds = unique(fixtures.map((fixture) => fixture.enterprise_id));
  const integrity = (message: string) =>
    new ConflictError(message, { code: "review_fixture_queue_integrity", fixtureKey });

  if (repoIds.length > 0) {
    const { rows: nonSyntheticMembers } = await client.query(
      `SELECT 1
         FROM submissions s
         JOIN users u ON u.id = s.user_id
        WHERE s.repo_id = ANY($1::int[]) AND u.is_test_account = false
        LIMIT 1`,
      [repoIds],
    );
    if (nonSyntheticMembers.length > 0) {
      throw integrity("Review fixture project was attached to a real account.");
    }
  }

  // A room has no marker column: its scope is inferred from the groups it serves
  // and the enterprise it is pooled into. Delete only rooms that are
  // synthetic-only by that inference, never one that real data also reaches.
  for (const roomId of roomIds) {
    const room = await inspectFixtureRoomScope(client, roomId);
    if (room.exists && room.has_graph && (!room.has_synthetic || room.has_real)) {
      throw integrity("Review fixture room is not synthetic-only.");
    }
  }

  // Creating a challenge automatically creates its default 1:1 queue group.
  // Capture those groups before deleting the challenges so the synthetic graph
  // can be removed completely. Only remove a group when it contains fixture
  // challenges alone and is not serving a room; a shared or operationally
  // assigned group is an integrity failure, not fixture-owned data.
  const fixtureQueueGroupIds: number[] = [];
  for (const challengeId of challengeIds) {
    const { rows: groupRows } = await client.query<{ queue_group_id: number }>(
      `SELECT queue_group_id
         FROM queue_group_challenges
        WHERE challenge_id = $1
        FOR UPDATE`,
      [challengeId],
    );
    if (groupRows.length > 1) {
      throw integrity("Review fixture challenge belongs to multiple queue groups.");
    }
    const groupId = groupRows[0]?.queue_group_id ?? null;
    if (groupId === null) continue;
    const { rows: siblingChallenges } = await client.query(
      `SELECT 1
         FROM queue_group_challenges
        WHERE queue_group_id = $1 AND NOT (challenge_id = ANY($2::int[]))
        LIMIT 1`,
      [groupId, challengeIds],
    );
    if (siblingChallenges.length > 0) {
      throw integrity("Review fixture challenge was merged with another challenge.");
    }
    const { rows: roomRefs } = await client.query(
      `SELECT 1 FROM room_queue_groups
        WHERE queue_group_id = $1 AND NOT (room_id = ANY($2::int[]))
        LIMIT 1`,
      [groupId, roomIds],
    );
    if (roomRefs.length > 0) {
      throw integrity("Review fixture queue group is assigned to a room.");
    }
    fixtureQueueGroupIds.push(groupId);
  }
  if (challengeIds.length > 0) {
    const { rows: otherEntries } = await client.query(
      `SELECT 1
         FROM queue_entries
        WHERE challenge_id = ANY($1::int[])
          AND NOT (id = ANY($2::int[]))
        LIMIT 1`,
      [challengeIds, entryIds],
    );
    if (otherEntries.length > 0) {
      throw integrity("Review fixture challenge was attached to another queue entry.");
    }
  }

  if (entryIds.length > 0) {
    await client.query(`DELETE FROM attempt_review_versions WHERE attempt_id = ANY($1::int[])`, [
      entryIds,
    ]);
    await client.query(`DELETE FROM attempt_review WHERE attempt_id = ANY($1::int[])`, [entryIds]);
    await client.query(`DELETE FROM judging_session WHERE queue_entry_id = ANY($1::int[])`, [
      entryIds,
    ]);
    await client.query(`DELETE FROM queue_history WHERE queue_entry_id = ANY($1::int[])`, [
      entryIds,
    ]);
    await client.query(`DELETE FROM queue_entries WHERE id = ANY($1::int[])`, [entryIds]);
  }

  if (roomIds.length > 0) {
    await client.query(`DELETE FROM judging_session WHERE room_id = ANY($1::int[])`, [roomIds]);
    await client.query(`DELETE FROM room_queue_groups WHERE room_id = ANY($1::int[])`, [roomIds]);
    await client.query(`DELETE FROM room_enterprises WHERE room_id = ANY($1::int[])`, [roomIds]);
    await client.query(`DELETE FROM room_queue_state WHERE room_id = ANY($1::int[])`, [roomIds]);
    await client.query(`DELETE FROM rooms WHERE id = ANY($1::int[])`, [roomIds]);
  }

  if (repoIds.length > 0) {
    await client.query(`DELETE FROM challenge_winners WHERE repo_id = ANY($1::int[])`, [repoIds]);
    await client.query(`DELETE FROM project_challenges WHERE repo_id = ANY($1::int[])`, [repoIds]);
    await client.query(`DELETE FROM submissions WHERE repo_id = ANY($1::int[])`, [repoIds]);
    await client.query(`DELETE FROM repos WHERE id = ANY($1::int[]) AND is_test_account = true`, [
      repoIds,
    ]);
  }

  if (challengeIds.length > 0) {
    await client.query(`DELETE FROM challenge_winners WHERE challenge_id = ANY($1::int[])`, [
      challengeIds,
    ]);
    await client.query(
      `DELETE FROM challenges WHERE id = ANY($1::int[]) AND is_test_account = true`,
      [challengeIds],
    );
  }

  if (fixtureQueueGroupIds.length > 0) {
    await client.query(
      `DELETE FROM queue_groups
        WHERE id = ANY($1::int[]) AND enterprise_id = ANY($2::int[])`,
      [fixtureQueueGroupIds, enterpriseIds],
    );
  }

  if (sponsorIds.length > 0) {
    await client.query(`DELETE FROM sponsors WHERE id = ANY($1::int[])`, [sponsorIds]);
  }

  if (enterpriseIds.length > 0) {
    const { rows: enterpriseRefs } = await client.query(
      `SELECT 1
         FROM sponsors WHERE enterprise_id = ANY($1::int[])
       UNION ALL
       SELECT 1
         FROM queue_groups WHERE enterprise_id = ANY($1::int[])
       UNION ALL
       SELECT 1
         FROM room_enterprises WHERE enterprise_id = ANY($1::int[])
        LIMIT 1`,
      [enterpriseIds],
    );
    if (enterpriseRefs.length > 0) {
      throw integrity("Review fixture enterprise has unexpected references.");
    }
    await client.query(`DELETE FROM enterprises WHERE id = ANY($1::int[])`, [enterpriseIds]);
  }

  await client.query(`DELETE FROM review_fixture_queues WHERE fixture_key = $1`, [fixtureKey]);
}

/** Purge every generated queue owned by a synthetic account before account scrub. */
export async function purgeReviewFixtureQueuesForUser(
  client: pg.PoolClient,
  userId: number,
): Promise<void> {
  const { rows } = await client.query<{ fixture_key: string }>(
    `SELECT fixture.fixture_key
       FROM review_fixture_accounts fixture
      WHERE fixture.user_id = $1
      ORDER BY fixture.fixture_key
      FOR UPDATE`,
    [userId],
  );
  for (const row of rows) await purgeReviewFixtureQueue(client, row.fixture_key);
}
