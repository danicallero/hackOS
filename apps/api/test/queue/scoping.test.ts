import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { asUser, createRole, createUser, useTestApp } from "../helpers.js";
import {
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  getEntry,
} from "./fixtures.js";

/**
 * Release-review scoping (H8, H29, H46): by-id queue resources of another
 * edition answer 404 from the viewed edition, the bulk queue generation only
 * touches the viewed edition, and the queue reset is a current-edition action.
 */

const getApp = useTestApp();

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

async function createEdition(key: string) {
  await (await db()).query(
    `INSERT INTO editions (event_key, name, status) VALUES ($1, $1, 'active')`,
    [key],
  );
}

/** A user holding `capabilities` in the current edition and in `e2`. */
async function staffInBoth(capabilities: string[]): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole(capabilities);
  const pool = await db();
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
    userId,
    roleId,
  ]);
  return userId;
}

async function challengeIn(eventKey: string): Promise<number> {
  const pool = await db();
  const ownerId = await createUser();
  const enterprise = await pool.query(
    `INSERT INTO enterprises (name, event_key) VALUES ($1, $2) RETURNING id`,
    [`ent-${crypto.randomUUID()}`, eventKey],
  );
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, ownerId],
  );
  const { rows } = await pool.query(
    `INSERT INTO challenges (author, title) VALUES ($1, $2) RETURNING id`,
    [sponsor.rows[0].id, `Challenge ${eventKey} ${crypto.randomUUID().slice(0, 6)}`],
  );
  return rows[0].id;
}

async function submittedRepoIn(eventKey: string, challengeId: number): Promise<number> {
  const pool = await db();
  const memberId = await createUser();
  const { rows } = await pool.query(
    `INSERT INTO repos (name, event_key, submission_status) VALUES ($1, $2, 'submitted') RETURNING id`,
    [`repo-${crypto.randomUUID().slice(0, 8)}`, eventKey],
  );
  await pool.query(`INSERT INTO submissions (repo_id, user_id) VALUES ($1, $2)`, [
    rows[0].id,
    memberId,
  ]);
  await pool.query(`INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2)`, [
    rows[0].id,
    challengeId,
  ]);
  return rows[0].id;
}

const as = (userId: number, edition?: string) => ({
  ...asUser(userId),
  ...(edition ? { "x-edition": edition } : {}),
});
const mutating = (userId: number, edition?: string) => ({
  ...as(userId, edition),
  "idempotency-key": crypto.randomUUID(),
});

describe("bulk queue generation (H29)", () => {
  it("enqueues only the viewed edition's challenges and refuses another edition's challenge", async () => {
    await createEdition("e2");
    const staff = await staffInBoth([CAPABILITIES.QUEUE_ADMIN]);
    const c1 = await challengeIn("default");
    const c2 = await challengeIn("e2");
    const repo1 = await submittedRepoIn("default", c1);
    await submittedRepoIn("e2", c2);
    const app = await getApp();

    const all = await app.inject({
      method: "POST",
      url: "/api/queue/challenges/enqueue-all",
      headers: mutating(staff),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().challenges.map((c: { challengeId: number }) => c.challengeId)).toEqual([c1]);
    expect(all.json().inserted).toBe(1);
    const pool = await db();
    const queued = await pool.query(`SELECT challenge_id FROM queue_entries`);
    expect(queued.rows.map((r) => r.challenge_id)).toEqual([c1]);

    // A caller-supplied challenge of another edition is not found, with no entry written.
    const foreign = await app.inject({
      method: "POST",
      url: `/api/queue/challenges/${c2}/enqueue`,
      headers: mutating(staff),
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);
    expect((await pool.query(`SELECT 1 FROM queue_entries`)).rowCount).toBe(1);

    // From the other edition the same bulk call only covers its own challenge.
    const viewed = await app.inject({
      method: "POST",
      url: "/api/queue/challenges/enqueue-all",
      headers: mutating(staff, "e2"),
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().challenges.map((c: { challengeId: number }) => c.challengeId)).toEqual([
      c2,
    ]);
    expect(repo1).toBeGreaterThan(0);
  });
});

describe("by-id queue resources of another edition (H8, H29, H46)", () => {
  it("answers 404 from the current edition and works from the entry's own edition", async () => {
    await createEdition("e2");
    const staff = await staffInBoth([
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.JUDGE_PANEL,
    ]);
    const c2 = await challengeIn("e2");
    const entryId = await enqueueRepo(
      c2,
      (
        await (
          await db()
        ).query(`INSERT INTO repos (name, event_key) VALUES ('r-e2', 'e2') RETURNING id`)
      ).rows[0].id,
      1,
    );
    const roomE2 = (
      await (
        await db()
      ).query(
        `INSERT INTO rooms (name, status, event_key) VALUES ('Room E2', 'active', 'e2') RETURNING id`,
      )
    ).rows[0].id;
    await (await db()).query(
      `INSERT INTO room_queue_state (room_id, is_paused) VALUES ($1, false)`,
      [roomE2],
    );
    const groupE2 = (
      await (
        await db()
      ).query(`SELECT queue_group_id FROM queue_group_challenges WHERE challenge_id = $1`, [c2])
    ).rows[0].queue_group_id;
    const app = await getApp();

    const reads = [
      `/api/queue/entries/${entryId}/history`,
      `/api/queue/entries/${entryId}/review`,
      `/api/queue/entries/${entryId}/review/versions`,
      `/api/queue/entries/${entryId}/sessions`,
      `/api/queue/rooms/${roomE2}`,
      `/api/queue/groups/${groupE2}/queue`,
    ];
    for (const url of reads) {
      const current = await app.inject({ method: "GET", url, headers: as(staff) });
      expect(current.statusCode, `${url} from the current edition`).toBe(404);
      const own = await app.inject({ method: "GET", url, headers: as(staff, "e2") });
      expect(own.statusCode, `${url} ${own.body}`).toBe(200);
    }

    const rename = await app.inject({
      method: "PATCH",
      url: `/api/queue/rooms/${roomE2}`,
      headers: as(staff),
      payload: { name: "Hijacked" },
    });
    expect(rename.statusCode).toBe(404);
    const cancel = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/cancel`,
      headers: mutating(staff),
      payload: {},
    });
    expect(cancel.statusCode).toBe(404);
    expect((await getEntry(entryId)).status).toBe("waiting");
    const pool = await db();
    expect((await pool.query(`SELECT name FROM rooms WHERE id = $1`, [roomE2])).rows[0].name).toBe(
      "Room E2",
    );

    // Same-edition resources of the current edition keep working.
    const room = await createRoom({ name: "Room current" });
    const challenge = await createChallenge();
    const entry = await enqueueRepo(challenge, (await createRepoWithTeam()).repoId, 1);
    for (const url of [`/api/queue/rooms/${room}`, `/api/queue/entries/${entry}/history`]) {
      const res = await app.inject({ method: "GET", url, headers: as(staff) });
      expect(res.statusCode, url).toBe(200);
    }
  });
});

describe("queue reset (H8)", () => {
  it("is a current-edition action", async () => {
    await createEdition("e2");
    const admin = await staffInBoth([CAPABILITIES.ADMIN_ALL]);
    const c2 = await challengeIn("e2");
    const entryId = await enqueueRepo(
      c2,
      (
        await (
          await db()
        ).query(`INSERT INTO repos (name, event_key) VALUES ('r-reset', 'e2') RETURNING id`)
      ).rows[0].id,
      1,
    );
    const app = await getApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/queue/admin/reset",
      headers: mutating(admin, "e2"),
      payload: { confirmationPhrase: "WIPE_Q_DATA", acknowledgeIrreversible: true },
    });
    expect(res.statusCode).toBe(409);
    expect((await getEntry(entryId)).status).toBe("waiting");
  });
});
