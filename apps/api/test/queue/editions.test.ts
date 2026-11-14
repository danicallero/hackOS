import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { asUser, createRole, createUser, useTestApp } from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  getEntry,
} from "./fixtures.js";

/**
 * Multi-edition queue (H29, H38, H40, H41): lists, boards, exports and the
 * participant status are scoped to the viewed edition; by-id endpoints work
 * across editions; a closed edition rejects queue mutations.
 */

const getApp = useTestApp();

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

async function createEdition(key: string, status: "draft" | "active" | "closed" = "active") {
  await (await db()).query(
    `INSERT INTO editions (event_key, name, status, closed_at)
     VALUES ($1, $2, $3, CASE WHEN $3 = 'closed' THEN now() END)`,
    [key, key.toUpperCase(), status],
  );
}

/** A staff user holding `capabilities` in the current edition and in `editions`. */
async function staffIn(capabilities: string[], editions: string[]): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole(capabilities);
  const pool = await db();
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  for (const key of editions) {
    await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, $3)`, [
      userId,
      roleId,
      key,
    ]);
  }
  return userId;
}

/** Challenge (+ its queue group) authored by an enterprise of `eventKey`. */
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

async function roomIn(eventKey: string, name: string): Promise<number> {
  const pool = await db();
  const { rows } = await pool.query(
    `INSERT INTO rooms (name, status, event_key) VALUES ($1, 'active', $2) RETURNING id`,
    [name, eventKey],
  );
  await pool.query(`INSERT INTO room_queue_state (room_id, is_paused) VALUES ($1, false)`, [
    rows[0].id,
  ]);
  return rows[0].id;
}

async function repoIn(eventKey: string, members: number[] = []): Promise<number> {
  const pool = await db();
  const { rows } = await pool.query(
    `INSERT INTO repos (name, event_key) VALUES ($1, $2) RETURNING id`,
    [`repo-${crypto.randomUUID().slice(0, 8)}`, eventKey],
  );
  for (const userId of members) {
    await pool.query(`INSERT INTO submissions (repo_id, user_id) VALUES ($1, $2)`, [
      rows[0].id,
      userId,
    ]);
  }
  return rows[0].id;
}

const edition = (key?: string) => (key ? { "x-edition": key } : {});

describe("queue lists are scoped to the viewed edition", () => {
  it("lists rooms and queue groups per edition", async () => {
    await createEdition("e2");
    const staff = await staffIn([CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.QUEUE_OPERATE], ["e2"]);
    const roomE1 = await createRoom({ name: "Room E1" });
    const roomE2 = await roomIn("e2", "Room E2");
    await challengeIn("default");
    await challengeIn("e2");
    const app = await getApp();

    const current = await app.inject({
      method: "GET",
      url: "/api/queue/rooms",
      headers: asUser(staff),
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().map((r: { id: number }) => r.id)).toEqual([roomE1]);

    const viewed = await app.inject({
      method: "GET",
      url: "/api/queue/rooms",
      headers: { ...asUser(staff), ...edition("e2") },
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().map((r: { id: number }) => r.id)).toEqual([roomE2]);

    const groups = async (key?: string) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/queue/groups",
        headers: { ...asUser(staff), ...edition(key) },
      });
      expect(res.statusCode).toBe(200);
      return res.json().groups as Array<{ id: number }>;
    };
    const pool = await db();
    const { rows } = await pool.query(`SELECT id, event_key FROM queue_groups ORDER BY id`);
    const e1Groups = rows.filter((g) => g.event_key === "default").map((g) => g.id);
    const e2Groups = rows.filter((g) => g.event_key === "e2").map((g) => g.id);
    expect(e1Groups).toHaveLength(1);
    expect(e2Groups).toHaveLength(1);
    expect((await groups()).map((g) => g.id)).toEqual(e1Groups);
    expect((await groups("e2")).map((g) => g.id)).toEqual(e2Groups);
  });

  it("scopes the room views board and the public TV snapshot", async () => {
    await createEdition("e2");
    const staff = await staffIn([CAPABILITIES.QUEUE_OPERATE], ["e2"]);
    const roomE1 = await createRoom({ name: "TV E1" });
    const roomE2 = await roomIn("e2", "TV E2");
    const app = await getApp();

    const views = async (key?: string) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/queue/rooms/views",
        headers: { ...asUser(staff), ...edition(key) },
      });
      expect(res.statusCode).toBe(200);
      return res.json().map((v: { room: { id: number } }) => v.room.id);
    };
    expect(await views()).toEqual([roomE1]);
    expect(await views("e2")).toEqual([roomE2]);

    const tv = async (key?: string) => {
      const res = await app.inject({ method: "GET", url: "/api/tv/rooms", headers: edition(key) });
      expect(res.statusCode).toBe(200);
      return res.json().map((v: { room: { id: number } }) => v.room.id);
    };
    expect(await tv()).toEqual([roomE1]);
    expect(await tv("e2")).toEqual([roomE2]);
  });

  it("scopes the reviews list and its CSV export", async () => {
    await createEdition("e2");
    const admin = await staffIn([CAPABILITIES.QUEUE_ADMIN], ["e2"]);
    const c1 = await challengeIn("default");
    const c2 = await challengeIn("e2");
    const repo1 = await repoIn("default");
    const repo2 = await repoIn("e2");
    const e1Entry = await enqueueRepo(c1, repo1, 1);
    const e2Entry = await enqueueRepo(c2, repo2, 1);
    const pool = await db();
    await pool.query(`UPDATE queue_entries SET status = 'completed' WHERE id = ANY($1)`, [
      [e1Entry, e2Entry],
    ]);
    const app = await getApp();

    const reviews = async (key?: string) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/queue/reviews",
        headers: { ...asUser(admin), ...edition(key) },
      });
      expect(res.statusCode).toBe(200);
      return res.json().reviews.map((r: { entryId: number }) => r.entryId);
    };
    expect(await reviews()).toEqual([e1Entry]);
    expect(await reviews("e2")).toEqual([e2Entry]);

    const csv = async (key?: string) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/queue/reviews/export.csv",
        headers: { ...asUser(admin), ...edition(key) },
      });
      expect(res.statusCode).toBe(200);
      return res.body;
    };
    const { rows } = await pool.query(`SELECT id, name FROM repos`);
    const name = (id: number) => rows.find((r) => r.id === id)?.name as string;
    const current = await csv();
    expect(current).toContain(name(repo1));
    expect(current).not.toContain(name(repo2));
    const viewed = await csv("e2");
    expect(viewed).toContain(name(repo2));
    expect(viewed).not.toContain(name(repo1));
  });

  it("scopes a participant's own queue status", async () => {
    await createEdition("e2");
    const me = await createUser();
    const roleId = await createRole([]);
    const pool = await db();
    await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
      me,
      roleId,
    ]);
    const c1 = await createChallenge();
    const c2 = await challengeIn("e2");
    await assignChallengeToRoom(await createRoom(), c1);
    const repo1 = await repoIn("default", [me]);
    const repo2 = await repoIn("e2", [me]);
    await enqueueRepo(c1, repo1, 1);
    await enqueueRepo(c2, repo2, 1);
    const app = await getApp();

    const status = async (key?: string) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/queue/me",
        headers: { ...asUser(me), ...edition(key) },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as Array<{ repoId: number }>;
    };
    expect((await status()).map((s) => s.repoId)).toEqual([repo1]);
    expect((await status("e2")).map((s) => s.repoId)).toEqual([repo2]);
  });
});

describe("queue by-id endpoints, mutations and ticks", () => {
  it("reads an entry's history regardless of the viewed edition", async () => {
    await createEdition("e2");
    const staff = await staffIn([CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.QUEUE_ADMIN], ["e2"]);
    const c2 = await challengeIn("e2");
    const entryId = await enqueueRepo(c2, await repoIn("e2"), 1);
    const app = await getApp();

    for (const key of [undefined, "e2"]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/queue/entries/${entryId}/history`,
        headers: { ...asUser(staff), ...edition(key) },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it("rejects a queue mutation in a closed edition with edition_closed", async () => {
    await createEdition("e3");
    const pool = await db();
    const c3 = await challengeIn("e3");
    const entryId = await enqueueRepo(c3, await repoIn("e3"), 1);
    const staff = await staffIn([CAPABILITIES.QUEUE_OPERATE], ["e3"]);
    await pool.query(
      `UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'e3'`,
    );
    const app = await getApp();

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/cancel`,
      headers: { ...asUser(staff), ...edition("e3"), "idempotency-key": crypto.randomUUID() },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).toContain("edition_closed");
    expect(
      (await pool.query(`SELECT status FROM queue_entries WHERE id = $1`, [entryId])).rows[0]
        .status,
    ).toBe("waiting");
  });

  it("the pump only serves the current edition and no-ops once it is closed", async () => {
    await createEdition("e2");
    const pool = await db();
    const roomE1 = await createRoom({ name: "Pump E1" });
    const c1 = await createChallenge();
    await assignChallengeToRoom(roomE1, c1);
    const e1Entry = await enqueueRepo(c1, (await createRepoWithTeam()).repoId, 1);
    const c2 = await challengeIn("e2");
    const e2Entry = await enqueueRepo(c2, await repoIn("e2"), 1);

    const { pumpTick } = await import("../../src/modules/queue/pump.js");
    await pumpTick();
    expect((await getEntry(e1Entry)).status).toBe("called");
    expect((await getEntry(e2Entry)).status).toBe("waiting");

    await pool.query(`UPDATE queue_entries SET status = 'waiting' WHERE id = $1`, [e1Entry]);
    await pool.query(
      `UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'default'`,
    );
    await pumpTick();
    expect((await getEntry(e1Entry)).status).toBe("waiting");
  });
});
