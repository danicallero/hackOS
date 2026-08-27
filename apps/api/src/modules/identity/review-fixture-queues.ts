import type pg from "pg";
import { ConflictError } from "../../lib/errors.js";

type FixtureQueueRow = {
  fixture_key: string;
  enterprise_id: number | null;
  sponsor_id: number | null;
  challenge_id: number | null;
  repo_id: number | null;
  queue_entry_id: number | null;
};

/**
 * Remove one generated synthetic queue and its project graph. The pointers
 * are checked before destructive work so an accidental registry edit cannot
 * delete a real project or challenge. A mismatch fails the surrounding
 * transaction closed and leaves the fixture available for repair.
 */
export async function purgeReviewFixtureQueue(
  client: pg.PoolClient,
  fixtureKey: string,
): Promise<void> {
  const { rows } = await client.query<FixtureQueueRow>(
    `SELECT fixture_key, enterprise_id, sponsor_id, challenge_id, repo_id, queue_entry_id
       FROM review_fixture_queues
      WHERE fixture_key = $1
      FOR UPDATE`,
    [fixtureKey],
  );
  const fixture = rows[0];
  if (!fixture) return;

  if (fixture.repo_id !== null) {
    const { rows: nonSyntheticMembers } = await client.query(
      `SELECT 1
         FROM submissions s
         JOIN users u ON u.id = s.user_id
        WHERE s.repo_id = $1 AND u.is_test_account = false
        LIMIT 1`,
      [fixture.repo_id],
    );
    if (nonSyntheticMembers.length > 0) {
      throw new ConflictError("Review fixture project was attached to a real account.", {
        code: "review_fixture_queue_integrity",
        fixtureKey,
      });
    }
  }

  // Creating a challenge automatically creates its default 1:1 queue group.
  // Capture that group before deleting the challenge so the synthetic graph
  // can be removed completely.  Only remove it when it contains this fixture
  // challenge alone and is not serving a room; a shared or operationally
  // assigned group is an integrity failure, not fixture-owned data.
  let fixtureQueueGroupId: number | null = null;
  if (fixture.challenge_id !== null) {
    const { rows: groupRows } = await client.query<{ queue_group_id: number }>(
      `SELECT queue_group_id
         FROM queue_group_challenges
        WHERE challenge_id = $1
        FOR UPDATE`,
      [fixture.challenge_id],
    );
    if (groupRows.length > 1) {
      throw new ConflictError("Review fixture challenge belongs to multiple queue groups.", {
        code: "review_fixture_queue_integrity",
        fixtureKey,
      });
    }
    fixtureQueueGroupId = groupRows[0]?.queue_group_id ?? null;
    if (fixtureQueueGroupId !== null) {
      const { rows: siblingChallenges } = await client.query(
        `SELECT 1
           FROM queue_group_challenges
          WHERE queue_group_id = $1 AND challenge_id <> $2
          LIMIT 1`,
        [fixtureQueueGroupId, fixture.challenge_id],
      );
      if (siblingChallenges.length > 0) {
        throw new ConflictError("Review fixture challenge was merged with another challenge.", {
          code: "review_fixture_queue_integrity",
          fixtureKey,
        });
      }
      const { rows: roomRefs } = await client.query(
        `SELECT 1 FROM room_queue_groups WHERE queue_group_id = $1 LIMIT 1`,
        [fixtureQueueGroupId],
      );
      if (roomRefs.length > 0) {
        throw new ConflictError("Review fixture queue group is assigned to a room.", {
          code: "review_fixture_queue_integrity",
          fixtureKey,
        });
      }
    }

    const { rows: otherEntries } = await client.query(
      `SELECT 1
         FROM queue_entries
        WHERE challenge_id = $1
          AND ($2::int IS NULL OR id <> $2)
        LIMIT 1`,
      [fixture.challenge_id, fixture.queue_entry_id],
    );
    if (otherEntries.length > 0) {
      throw new ConflictError("Review fixture challenge was attached to another queue entry.", {
        code: "review_fixture_queue_integrity",
        fixtureKey,
      });
    }
  }

  if (fixture.queue_entry_id !== null) {
    await client.query(`DELETE FROM attempt_review_versions WHERE attempt_id = $1`, [
      fixture.queue_entry_id,
    ]);
    await client.query(`DELETE FROM attempt_review WHERE attempt_id = $1`, [
      fixture.queue_entry_id,
    ]);
    await client.query(`DELETE FROM judging_session WHERE queue_entry_id = $1`, [
      fixture.queue_entry_id,
    ]);
    await client.query(`DELETE FROM queue_history WHERE queue_entry_id = $1`, [
      fixture.queue_entry_id,
    ]);
    await client.query(`DELETE FROM queue_entries WHERE id = $1`, [fixture.queue_entry_id]);
  }

  if (fixture.repo_id !== null) {
    await client.query(`DELETE FROM challenge_winners WHERE repo_id = $1`, [fixture.repo_id]);
    await client.query(`DELETE FROM repo_devpost_prizes WHERE repo_id = $1`, [fixture.repo_id]);
    await client.query(`DELETE FROM devpost_participants WHERE repo_id = $1`, [fixture.repo_id]);
    await client.query(`DELETE FROM submissions WHERE repo_id = $1`, [fixture.repo_id]);
    await client.query(`DELETE FROM repos WHERE id = $1 AND is_test_account = true`, [
      fixture.repo_id,
    ]);
  }

  if (fixture.challenge_id !== null) {
    await client.query(`DELETE FROM challenge_winners WHERE challenge_id = $1`, [
      fixture.challenge_id,
    ]);
    await client.query(`DELETE FROM challenges WHERE id = $1 AND is_test_account = true`, [
      fixture.challenge_id,
    ]);
  }

  if (fixtureQueueGroupId !== null) {
    await client.query(
      `DELETE FROM queue_groups
        WHERE id = $1 AND enterprise_id = $2`,
      [fixtureQueueGroupId, fixture.enterprise_id],
    );
  }

  if (fixture.sponsor_id !== null) {
    await client.query(`DELETE FROM sponsors WHERE id = $1`, [fixture.sponsor_id]);
  }

  if (fixture.enterprise_id !== null) {
    const { rows: enterpriseRefs } = await client.query(
      `SELECT 1
         FROM sponsors WHERE enterprise_id = $1
       UNION ALL
       SELECT 1
         FROM queue_groups WHERE enterprise_id = $1
       UNION ALL
       SELECT 1
         FROM room_enterprises WHERE enterprise_id = $1
        LIMIT 1`,
      [fixture.enterprise_id],
    );
    if (enterpriseRefs.length > 0) {
      throw new ConflictError("Review fixture enterprise has unexpected references.", {
        code: "review_fixture_queue_integrity",
        fixtureKey,
      });
    }
    await client.query(`DELETE FROM enterprises WHERE id = $1`, [fixture.enterprise_id]);
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
