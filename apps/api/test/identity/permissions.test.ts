import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** H8: permission-group CRUD, groups of groups (cycle rejection), members, cache invalidation. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

async function admin(): Promise<number> {
  return createUserWithCapabilities([CAPABILITIES.PERMISSIONS_MANAGE]);
}

async function createGroup(
  a: App,
  actor: number,
  name: string,
  capabilities: string[] = [],
): Promise<number> {
  const res = await a.inject({
    method: "POST",
    url: "/api/permission-groups",
    headers: asUser(actor),
    payload: { name, capabilities },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

describe("H8 permission groups", () => {
  it("requires PERMISSIONS_MANAGE on every route", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const res = await a.inject({
      method: "POST",
      url: "/api/permission-groups",
      headers: asUser(pleb),
      payload: { name: "nope" },
    });
    expect(res.statusCode).toBe(403);
    expect((await a.inject({ method: "GET", url: "/api/permission-groups" })).statusCode).toBe(401);
  });

  it("CRUD with audit rows (H53)", async () => {
    const a = await getApp();
    const actor = await admin();
    const groupId = await createGroup(a, actor, "scanners", [CAPABILITIES.ACCREDIT_SCAN]);

    const got = await a.inject({
      method: "GET",
      url: `/api/permission-groups/${groupId}`,
      headers: asUser(actor),
    });
    expect(got.json().capabilities).toEqual([CAPABILITIES.ACCREDIT_SCAN]);

    const patched = await a.inject({
      method: "PATCH",
      url: `/api/permission-groups/${groupId}`,
      headers: asUser(actor),
      payload: { description: "day-of volunteers" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().description).toBe("day-of volunteers");

    const dup = await a.inject({
      method: "POST",
      url: "/api/permission-groups",
      headers: asUser(actor),
      payload: { name: "scanners" },
    });
    expect(dup.statusCode).toBe(409);

    const del = await a.inject({
      method: "DELETE",
      url: `/api/permission-groups/${groupId}`,
      headers: asUser(actor),
    });
    expect(del.statusCode).toBe(200);
    expect(
      (
        await a.inject({
          method: "GET",
          url: `/api/permission-groups/${groupId}`,
          headers: asUser(actor),
        })
      ).statusCode,
    ).toBe(404);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'permission_group' AND entity_id = $1 ORDER BY id`,
      [String(groupId)],
    );
    expect(rows.map((r: { action: string }) => r.action)).toEqual(["create", "update", "delete"]);
  });

  it("membership grants take effect immediately (cache invalidated)", async () => {
    const a = await getApp();
    const actor = await admin();
    const user = await createUser();
    const groupId = await createGroup(a, actor, "readers", [CAPABILITIES.USERS_READ]);

    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    // Prime the cache with "no capabilities"
    expect(await userHasCapability(user, CAPABILITIES.USERS_READ)).toBe(false);

    const add = await a.inject({
      method: "POST",
      url: `/api/permission-groups/${groupId}/members`,
      headers: asUser(actor),
      payload: { userId: user },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().members).toContain(user);
    const { pool } = await import("../../src/db/pool.js");
    const { rows: tickets } = await pool.query(`SELECT token FROM tickets WHERE user_id = $1`, [
      user,
    ]);
    expect(tickets).toHaveLength(1);
    // If invalidateCapabilities() hadn't run, the primed cache would still say false.
    expect(await userHasCapability(user, CAPABILITIES.USERS_READ)).toBe(true);

    const remove = await a.inject({
      method: "DELETE",
      url: `/api/permission-groups/${groupId}/members/${user}`,
      headers: asUser(actor),
    });
    expect(remove.statusCode).toBe(200);
    expect(await userHasCapability(user, CAPABILITIES.USERS_READ)).toBe(false);
  });

  it("PUT capabilities replaces the set and flushes every cache entry", async () => {
    const a = await getApp();
    const actor = await admin();
    const user = await createUser();
    const groupId = await createGroup(a, actor, "evolving", [CAPABILITIES.USERS_READ]);
    await a.inject({
      method: "POST",
      url: `/api/permission-groups/${groupId}/members`,
      headers: asUser(actor),
      payload: { userId: user },
    });

    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    expect(await userHasCapability(user, CAPABILITIES.USERS_READ)).toBe(true); // primes cache

    const put = await a.inject({
      method: "PUT",
      url: `/api/permission-groups/${groupId}/capabilities`,
      headers: asUser(actor),
      payload: { capabilities: [CAPABILITIES.QUEUE_OPERATE] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().capabilities).toEqual([CAPABILITIES.QUEUE_OPERATE]);

    expect(await userHasCapability(user, CAPABILITIES.USERS_READ)).toBe(false);
    expect(await userHasCapability(user, CAPABILITIES.QUEUE_OPERATE)).toBe(true);
  });

  it("groups of groups resolve transitively; direct and deep cycles are 409s", async () => {
    const a = await getApp();
    const actor = await admin();
    const parent = await createGroup(a, actor, "staff-day");
    const middle = await createGroup(a, actor, "operators");
    const leaf = await createGroup(a, actor, "scanners", [CAPABILITIES.ACCREDIT_SCAN]);

    const include = async (p: number, c: number) =>
      a.inject({
        method: "POST",
        url: `/api/permission-groups/${p}/includes`,
        headers: asUser(actor),
        payload: { childGroupId: c },
      });

    expect((await include(parent, middle)).statusCode).toBe(200);
    expect((await include(middle, leaf)).statusCode).toBe(200);

    // membership in parent grants the leaf capability through two hops
    const user = await createUser();
    await a.inject({
      method: "POST",
      url: `/api/permission-groups/${parent}/members`,
      headers: asUser(actor),
      payload: { userId: user },
    });
    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    expect(await userHasCapability(user, CAPABILITIES.ACCREDIT_SCAN)).toBe(true);

    // self-include, direct cycle, deep cycle
    expect((await include(parent, parent)).statusCode).toBe(409);
    expect((await include(middle, parent)).statusCode).toBe(409);
    const deep = await include(leaf, parent);
    expect(deep.statusCode).toBe(409);
    expect(deep.json().error.code).toBe("conflict");

    // removing an include severs the chain immediately
    const remove = await a.inject({
      method: "DELETE",
      url: `/api/permission-groups/${middle}/includes/${leaf}`,
      headers: asUser(actor),
    });
    expect(remove.statusCode).toBe(200);
    expect(await userHasCapability(user, CAPABILITIES.ACCREDIT_SCAN)).toBe(false);
  });

  it("adding an unknown user as member 404s", async () => {
    const a = await getApp();
    const actor = await admin();
    const groupId = await createGroup(a, actor, "ghost-group");
    const res = await a.inject({
      method: "POST",
      url: `/api/permission-groups/${groupId}/members`,
      headers: asUser(actor),
      payload: { userId: 999999 },
    });
    expect(res.statusCode).toBe(404);
  });
});
