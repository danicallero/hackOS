import "./env.js";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import {
  assertFixtureEnterpriseScope,
  assertFixtureEnterpriseScopes,
  assertFixtureQueueScope,
  assertFixtureQueueScopes,
} from "../../src/modules/logistics/review-fixture-scope.js";
import { queueEntryFixtureMarkers, queueFixtureMarker } from "../../src/modules/queue/broadcast.js";
import { createUser, truncateAll } from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
} from "./fixtures.js";

async function markSyntheticChallenge(challengeId: number): Promise<void> {
  await pool.query(`UPDATE challenges SET is_test_account = true WHERE id = $1`, [challengeId]);
  await pool.query(
    `UPDATE users u SET is_test_account = true FROM sponsors s
      WHERE s.user_id = u.id AND s.id = (SELECT author FROM challenges WHERE id = $1)`,
    [challengeId],
  );
}

async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return { ok: await run() };
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    return { error: e.statusCode, message: e.message };
  }
}

describe("batch fixture helpers match their per-item counterparts", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("queueEntryFixtureMarkers equals queueFixtureMarker for real, synthetic, mismatched and missing entries", async () => {
    const realChallenge = await createChallenge({ title: "Real" });
    const { repoId: realRepo } = await createRepoWithTeam(undefined, "Real team");
    const realRoom = await createRoom({ name: "Real room" });
    await assignChallengeToRoom(realRoom, realChallenge);
    const realEntry = await enqueueRepo(realChallenge, realRepo, 1);

    const member = await createUser();
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [member]);
    const fixtureChallenge = await createChallenge({ title: "Synthetic" });
    await markSyntheticChallenge(fixtureChallenge);
    const { repoId: fixtureRepo } = await createRepoWithTeam([member], "Synthetic team");
    await pool.query(`UPDATE repos SET is_test_account = true WHERE id = $1`, [fixtureRepo]);
    const fixtureEntry = await enqueueRepo(fixtureChallenge, fixtureRepo, 1);

    const mismatchChallenge = await createChallenge({ title: "Mismatch" });
    const { repoId: mismatchRepo } = await createRepoWithTeam(undefined, "Mismatch team");
    await pool.query(`UPDATE repos SET is_test_account = true WHERE id = $1`, [mismatchRepo]);
    const mismatchEntry = await enqueueRepo(mismatchChallenge, mismatchRepo, 1);

    // Assigned room whose marker disagrees with the entry's.
    await pool.query(`UPDATE queue_entries SET assigned_room_id = $2 WHERE id = $1`, [
      fixtureEntry,
      realRoom,
    ]);

    const ids = [realEntry, fixtureEntry, mismatchEntry, 999_999];
    const batch = await queueEntryFixtureMarkers(pool, ids);
    for (const id of ids) {
      expect(batch.get(id)).toBe(await queueFixtureMarker(pool, "entry", id));
    }
    expect(batch.get(realEntry)).toBe(false);
    expect(batch.get(fixtureEntry)).toBeNull();
    expect(batch.get(mismatchEntry)).toBeNull();
    expect(batch.get(999_999)).toBeNull();
  });

  it("assertFixtureQueueScopes throws what the per-target loop throws", async () => {
    const operator = await createUser();
    const realChallenge = await createChallenge({ title: "Real" });
    const fixtureChallenge = await createChallenge({ title: "Synthetic" });
    await markSyntheticChallenge(fixtureChallenge);
    const { repoId } = await createRepoWithTeam(undefined, "Team");
    const entry = await enqueueRepo(realChallenge, repoId, 1);
    const room = await createRoom({ name: "Room" });

    const cases = [
      [{ resource: "challenge" as const, id: realChallenge }],
      [
        { resource: "challenge" as const, id: realChallenge },
        { resource: "challenge" as const, id: fixtureChallenge },
        { resource: "challenge" as const, id: 999_999 },
      ],
      [
        { resource: "entry" as const, id: entry },
        { resource: "repo" as const, id: repoId },
        { resource: "room" as const, id: room },
        { resource: "queueGroup" as const, id: 999_999 },
        { resource: "challenge" as const, id: fixtureChallenge },
      ],
    ];
    for (const actor of [operator]) {
      for (const targets of cases) {
        const loop = await outcome(async () => {
          for (const t of targets) await assertFixtureQueueScope(pool, actor, t.resource, t.id);
        });
        const batch = await outcome(() => assertFixtureQueueScopes(pool, actor, targets));
        expect(batch).toEqual(loop);
      }
    }
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [operator]);
    for (const targets of cases) {
      const loop = await outcome(async () => {
        for (const t of targets) await assertFixtureQueueScope(pool, operator, t.resource, t.id);
      });
      const batch = await outcome(() => assertFixtureQueueScopes(pool, operator, targets));
      expect(batch).toEqual(loop);
    }
  });

  it("assertFixtureEnterpriseScopes throws what the per-enterprise loop throws", async () => {
    const operator = await createUser();
    const { rows } = await pool.query(
      `INSERT INTO enterprises (name) VALUES ('A'), ('B') RETURNING id`,
    );
    const ids = rows.map((r) => Number(r.id));
    for (const synthetic of [false, true]) {
      await pool.query(`UPDATE users SET is_test_account = $2 WHERE id = $1`, [
        operator,
        synthetic,
      ]);
      const loop = await outcome(async () => {
        for (const id of ids) await assertFixtureEnterpriseScope(pool, operator, id);
      });
      const batch = await outcome(() => assertFixtureEnterpriseScopes(pool, operator, ids));
      expect(batch).toEqual(loop);
    }
  });
});
