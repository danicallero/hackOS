import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createRole, createUser, truncateAll } from "../helpers.js";

/** H8: a diary entry is edited and removed in its own edition only. */

let app: App;
let owner: number;
let entryId: number;

beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  await pool.query(`INSERT INTO editions (event_key, name, status) VALUES ('e2', 'E2', 'active')`);
  owner = await createUser();
  // The owner participates in both editions, so each can be viewed.
  const role = await createRole([]);
  for (const key of ["default", "e2"]) {
    await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, $3)`, [
      owner,
      role,
      key,
    ]);
  }
  const target = await createUser();
  const { rows } = await pool.query(
    `INSERT INTO diary_entries (owner_id, target_user_id, event_key)
     VALUES ($1, $2, 'e2') RETURNING id`,
    [owner, target],
  );
  entryId = rows[0].id;
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

const headers = (edition?: string) => ({
  ...asUser(owner),
  "idempotency-key": crypto.randomUUID(),
  ...(edition ? { "x-edition": edition } : {}),
});

describe("diary entries by id per edition", () => {
  it("answers 404 to an update or removal from another edition and leaves the entry", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/me/diary/${entryId}`,
      headers: headers(),
      payload: { starred: true },
    });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/me/diary/${entryId}`,
      headers: headers(),
    });
    expect(del.statusCode).toBe(404);
    const { rows } = await pool.query(`SELECT starred FROM diary_entries WHERE id = $1`, [entryId]);
    expect(rows).toEqual([{ starred: false }]);
  });

  it("updates and removes the entry in its own edition", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/me/diary/${entryId}`,
      headers: headers("e2"),
      payload: { starred: true },
    });
    expect(patch.statusCode).toBe(200);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/me/diary/${entryId}`,
      headers: headers("e2"),
    });
    expect(del.statusCode).toBe(204);
  });
});
