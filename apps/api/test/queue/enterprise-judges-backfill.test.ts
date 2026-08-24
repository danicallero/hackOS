import "./env.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { createUser, truncateAll } from "../helpers.js";

/**
 * The 0405 backfill turns every room-scoped judge into a roster judge of the
 * enterprise that authored the room's challenge. `room_judges` no longer
 * exists after 0406, so the test recreates its 0001 shape, seeds it, and runs
 * the migration's own INSERT statement verbatim from disk.
 */

const MIGRATION = resolve(import.meta.dirname, "../../db/migrations/0405_enterprise_judges.sql");

async function backfillStatement(): Promise<string> {
  const sql = await readFile(MIGRATION, "utf8");
  const start = sql.indexOf("INSERT INTO enterprise_judges");
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start);
}

beforeEach(async () => {
  await truncateAll();
  await pool.query(`DROP TABLE IF EXISTS room_judges`);
  await pool.query(
    `CREATE TABLE room_judges (
       room_id integer NOT NULL REFERENCES rooms(id),
       challenge_id integer NOT NULL REFERENCES challenges(id),
       user_id integer NOT NULL REFERENCES users(id),
       assigned_by integer REFERENCES users(id),
       assigned_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (room_id, challenge_id, user_id)
     )`,
  );
});

afterAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS room_judges`);
  await pool.end();
});

async function seedChallenge(enterpriseName: string): Promise<{
  enterpriseId: number;
  challengeId: number;
}> {
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    enterpriseName,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id) VALUES ($1) RETURNING id`,
    [enterprise.rows[0].id],
  );
  const challenge = await pool.query(
    `INSERT INTO challenges (author, title) VALUES ($1, $2) RETURNING id`,
    [sponsor.rows[0].id, `${enterpriseName} challenge`],
  );
  return {
    enterpriseId: Number(enterprise.rows[0].id),
    challengeId: Number(challenge.rows[0].id),
  };
}

async function seedRoom(slug: string): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO rooms (name, slug) VALUES ($1, $2) RETURNING id`, [
    slug,
    slug,
  ]);
  return Number(rows[0].id);
}

describe("0405 enterprise_judges backfill", () => {
  it("collapses a judge's rooms into one roster row per enterprise, keeping cross-enterprise rows apart", async () => {
    const acme = await seedChallenge("Acme");
    const beta = await seedChallenge("Beta");
    const judge = await createUser();
    const assigner = await createUser();
    const roomOne = await seedRoom("room-one");
    const roomTwo = await seedRoom("room-two");
    const roomThree = await seedRoom("room-three");

    // Two rooms of the SAME enterprise (provenance keeps the earliest row) …
    await pool.query(
      `INSERT INTO room_judges (room_id, challenge_id, user_id, assigned_by, assigned_at)
       VALUES ($1, $2, $3, $4, '2026-01-02T00:00:00Z'),
              ($5, $2, $3, NULL, '2026-01-01T00:00:00Z')`,
      [roomTwo, acme.challengeId, judge, assigner, roomOne],
    );
    // … and one room of a different enterprise: a separate roster row.
    await pool.query(
      `INSERT INTO room_judges (room_id, challenge_id, user_id) VALUES ($1, $2, $3)`,
      [roomThree, beta.challengeId, judge],
    );

    await pool.query(await backfillStatement());

    const { rows } = await pool.query(
      `SELECT enterprise_id, user_id, added_by, added_at
         FROM enterprise_judges ORDER BY enterprise_id`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => Number(r.enterprise_id)).sort()).toEqual(
      [acme.enterpriseId, beta.enterpriseId].sort(),
    );
    const acmeRow = rows.find((r) => Number(r.enterprise_id) === acme.enterpriseId);
    expect(Number(acmeRow.user_id)).toBe(judge);
    expect(acmeRow.added_by).toBeNull(); // earliest assignment wins
    expect((acmeRow.added_at as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is idempotent and leaves an enterprise with no room judges empty", async () => {
    const acme = await seedChallenge("Acme");
    await seedChallenge("Quiet");
    const judge = await createUser();
    const room = await seedRoom("room-solo");
    await pool.query(
      `INSERT INTO room_judges (room_id, challenge_id, user_id) VALUES ($1, $2, $3)`,
      [room, acme.challengeId, judge],
    );

    const statement = await backfillStatement();
    await pool.query(statement);
    await pool.query(statement); // ON CONFLICT DO NOTHING

    const { rows } = await pool.query(`SELECT enterprise_id FROM enterprise_judges`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].enterprise_id)).toBe(acme.enterpriseId);
  });
});
