import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/**
 * H18/H8: a content report belongs to the edition it was filed in. The
 * moderation inbox no longer derives it from the reporter's diary entry.
 */

let app: App;
let moderator: number;
let reporter: number;
let target: number;

beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  await pool.query(`INSERT INTO editions (event_key, name, status) VALUES ('e2', 'E2', 'active')`);
  moderator = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id, event_key)
     SELECT user_id, role_id, 'e2' FROM user_roles WHERE user_id = $1`,
    [moderator],
  );
  reporter = await createUser({ name: "Reporter" });
  target = await createUser({ name: "Target" });
  await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
    reporter,
    await createRole([]),
  ]);
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function seedReport(eventKey: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO content_reports (reporter_id, target_user_id, reason, event_key)
     VALUES ($1, $2, 'spam', $3) RETURNING id`,
    [reporter, target, eventKey],
  );
  return rows[0].id;
}

const inbox = async (edition?: string) =>
  (
    await app.inject({
      method: "GET",
      url: "/api/content-reports?status=open",
      headers: { ...asUser(moderator), ...(edition ? { "x-edition": edition } : {}) },
    })
  ).json().items as { id: number }[];

describe("content reports per edition", () => {
  it("lists a person report in its own edition without any diary entry", async () => {
    const id = await seedReport("default");
    expect((await inbox()).map((r) => r.id)).toEqual([id]);
    expect(await inbox("e2")).toEqual([]);
  });

  it("does not show a report in both editions when the reporter saved the person in both", async () => {
    const id = await seedReport("e2");
    await pool.query(
      `INSERT INTO diary_entries (owner_id, target_user_id, event_key)
       VALUES ($1, $2, 'default'), ($1, $2, 'e2')`,
      [reporter, target],
    );
    expect(await inbox()).toEqual([]);
    expect((await inbox("e2")).map((r) => r.id)).toEqual([id]);
  });

  it("answers 404 when resolving a report of another edition and resolves it in its own", async () => {
    const id = await seedReport("e2");
    const resolve = (edition?: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/content-reports/${id}`,
        headers: {
          ...asUser(moderator),
          "idempotency-key": crypto.randomUUID(),
          ...(edition ? { "x-edition": edition } : {}),
        },
        payload: { status: "dismissed" },
      });
    expect((await resolve()).statusCode).toBe(404);
    expect((await resolve("e2")).statusCode).toBeLessThan(300);
  });

  it("allows one open report per reporter, person and edition", async () => {
    const first = await seedReport("default");
    const second = await seedReport("e2");
    expect(second).not.toBe(first);
    await expect(seedReport("e2")).rejects.toMatchObject({ code: "23505" });
  });
});
