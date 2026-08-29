import "./env.js";
import { ALL_CAPABILITIES, CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import { PERMISSION_GROUP_TEMPLATES } from "../../src/modules/identity/templates.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** H8: permission-group CRUD, graph safety, and immediate PostgreSQL authorization. */

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

async function wildcardAdmin(): Promise<number> {
  return createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
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
  it("serves the exact permission-template catalogue without sponsor:portal", async () => {
    const a = await getApp();
    const actor = await admin();
    const res = await a.inject({
      method: "GET",
      url: "/api/permission-group-templates",
      headers: asUser(actor),
    });
    expect(res.statusCode).toBe(200);
    const templates = res.json() as Array<{
      key: string;
      labelKey: string;
      descriptionKey: string;
      capabilities: string[];
    }>;
    expect(templates).toEqual(
      PERMISSION_GROUP_TEMPLATES.map((template) => ({
        key: template.key,
        labelKey: template.labelKey,
        descriptionKey: template.descriptionKey,
        capabilities: [...template.capabilities],
      })),
    );
    expect(templates).toHaveLength(20);
    expect(templates.flatMap((template) => template.capabilities)).not.toContain(
      CAPABILITIES.SPONSOR_PORTAL,
    );
  });

  it("instantiates editable templates with unique names and exact capabilities", async () => {
    const a = await getApp();
    const actor = await admin();
    const payload = { name: "Front-desk operators", description: "Friday shift" };
    const created = await a.inject({
      method: "POST",
      url: "/api/permission-group-templates/accreditation-station/instantiate",
      headers: asUser(actor),
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: payload.name,
      description: payload.description,
      templateKey: "accreditation-station",
      templateDrifted: false,
      capabilities: [CAPABILITIES.ACCREDIT_SCAN],
      includes: [],
      members: [],
    });

    const duplicate = await a.inject({
      method: "POST",
      url: "/api/permission-group-templates/accreditation-station/instantiate",
      headers: asUser(actor),
      payload,
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("reports direct-capability and include drift, then resets while preserving metadata and members", async () => {
    const a = await getApp();
    const actor = await admin();
    const member = await createUser();
    const created = await a.inject({
      method: "POST",
      url: "/api/permission-group-templates/access-administrator/instantiate",
      headers: asUser(actor),
      payload: { name: "Access team", description: "Preserve this description" },
    });
    const groupId = created.json().id as number;
    const customChild = await createGroup(a, actor, "custom-child", [CAPABILITIES.ACCREDIT_SCAN]);
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/permission-groups/${groupId}/members`,
          headers: asUser(actor),
          payload: { userId: member },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await a.inject({
          method: "PUT",
          url: `/api/permission-groups/${groupId}/capabilities`,
          headers: asUser(actor),
          payload: { capabilities: [CAPABILITIES.USERS_READ] },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/permission-groups/${groupId}/includes`,
          headers: asUser(actor),
          payload: { childGroupId: customChild },
        })
      ).statusCode,
    ).toBe(200);

    const drifted = await a.inject({
      method: "GET",
      url: `/api/permission-groups/${groupId}`,
      headers: asUser(actor),
    });
    expect(drifted.json().templateDrifted).toBe(true);

    const reset = await a.inject({
      method: "POST",
      url: `/api/permission-groups/${groupId}/reset-template`,
      headers: asUser(actor),
      payload: {},
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({
      name: "Access team",
      description: "Preserve this description",
      templateKey: "access-administrator",
      templateDrifted: false,
      capabilities: [
        CAPABILITIES.USERS_READ,
        CAPABILITIES.USERS_WRITE,
        CAPABILITIES.PERMISSIONS_MANAGE,
        CAPABILITIES.INVITES_MANAGE,
        CAPABILITIES.AUDIT_READ,
      ].sort(),
      includes: [],
      members: [member],
    });
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT action, before, after FROM audit_log
       WHERE entity_type = 'permission_group' AND entity_id = $1
       ORDER BY id`,
      [String(groupId)],
    );
    expect(rows.map((row: { action: string }) => row.action)).toContain("instantiate_template");
    expect(rows.map((row: { action: string }) => row.action)).toContain("reset_template");
    expect(rows.at(-1)?.before.includes).toEqual([customChild]);
    expect(rows.at(-1)?.after.includes).toEqual([]);
  });

  it("restricts platform-template instantiate and reset to an existing wildcard holder", async () => {
    const a = await getApp();
    const manager = await admin();
    const deniedInstantiate = await a.inject({
      method: "POST",
      url: "/api/permission-group-templates/platform-administrator/instantiate",
      headers: asUser(manager),
      payload: { name: "Forbidden platform group" },
    });
    expect(deniedInstantiate.statusCode).toBe(403);

    const wildcard = await wildcardAdmin();
    const created = await a.inject({
      method: "POST",
      url: "/api/permission-group-templates/platform-administrator/instantiate",
      headers: asUser(wildcard),
      payload: { name: "Platform team" },
    });
    expect(created.statusCode).toBe(201);
    const deniedReset = await a.inject({
      method: "POST",
      url: `/api/permission-groups/${created.json().id}/reset-template`,
      headers: asUser(manager),
      payload: {},
    });
    expect(deniedReset.statusCode).toBe(403);
  });

  it("rolls back a template reset that would remove the last active wildcard holder", async () => {
    const a = await getApp();
    const wildcard = await wildcardAdmin();
    const ordinary = await a.inject({
      method: "POST",
      url: "/api/permission-group-templates/access-administrator/instantiate",
      headers: asUser(wildcard),
      payload: { name: "Temporary wildcard inheritance" },
    });
    expect(ordinary.statusCode).toBe(201);
    const groupId = ordinary.json().id as number;
    const { pool } = await import("../../src/db/pool.js");
    const source = await pool.query(
      `SELECT gc.group_id
       FROM permission_group_members pgm
       JOIN group_capabilities gc ON gc.group_id = pgm.group_id
      WHERE pgm.user_id = $1 AND gc.capability = $2`,
      [wildcard, CAPABILITIES.ADMIN_ALL],
    );
    const sourceGroupId = source.rows[0].group_id as number;
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/permission-groups/${groupId}/members`,
          headers: asUser(wildcard),
          payload: { userId: wildcard },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/permission-groups/${groupId}/includes`,
          headers: asUser(wildcard),
          payload: { childGroupId: sourceGroupId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await a.inject({
          method: "DELETE",
          url: `/api/permission-groups/${sourceGroupId}/members/${wildcard}`,
          headers: asUser(wildcard),
        })
      ).statusCode,
    ).toBe(200);

    const reset = await a.inject({
      method: "POST",
      url: `/api/permission-groups/${groupId}/reset-template`,
      headers: asUser(wildcard),
      payload: {},
    });
    expect(reset.statusCode).toBe(409);
    const unchanged = await a.inject({
      method: "GET",
      url: `/api/permission-groups/${groupId}`,
      headers: asUser(wildcard),
    });
    expect(unchanged.json().includes).toEqual([sourceGroupId]);
  });

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

  it("membership grants and revocations take effect on the next PostgreSQL authorization", async () => {
    const a = await getApp();
    const actor = await admin();
    const user = await createUser();
    const groupId = await createGroup(a, actor, "readers", [CAPABILITIES.USERS_READ]);

    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    // Prime a prior, unrelated authorization read.
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
    expect(await userHasCapability(user, CAPABILITIES.USERS_READ)).toBe(true);

    const remove = await a.inject({
      method: "DELETE",
      url: `/api/permission-groups/${groupId}/members/${user}`,
      headers: asUser(actor),
    });
    expect(remove.statusCode).toBe(200);
    expect(await userHasCapability(user, CAPABILITIES.USERS_READ)).toBe(false);
  });

  it("PUT capabilities replaces the effective PostgreSQL set", async () => {
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
    expect(await userHasCapability(user, CAPABILITIES.USERS_READ)).toBe(true);

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

  it("rejects unknown capabilities before writing them and keeps the DB catalogue synchronized", async () => {
    const a = await getApp();
    const actor = await admin();
    const invalid = await a.inject({
      method: "POST",
      url: "/api/permission-groups",
      headers: asUser(actor),
      payload: { name: "invalid", capabilities: ["not:a:capability"] },
    });
    expect(invalid.statusCode).toBe(400);

    const { pool } = await import("../../src/db/pool.js");
    const groupId = await createGroup(a, actor, "db-constraint-check");
    await expect(
      pool.query(`INSERT INTO group_capabilities (group_id, capability) VALUES ($1, $2)`, [
        groupId,
        "not:a:capability",
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'group_capabilities_known_catalogue'`,
    );
    const defined = [...String(rows[0]?.definition ?? "").matchAll(/'([^']+)'/g)]
      .map((match) => match[1])
      .sort();
    expect(defined).toEqual([...ALL_CAPABILITIES].sort());
  });

  it("does not let a permissions manager manufacture or remove wildcard access", async () => {
    const a = await getApp();
    const manager = await admin();
    const wildcardHolder = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    const { rows: groups } = await pool.query(
      `INSERT INTO permission_groups (name) VALUES ('sole-platform-admin') RETURNING id`,
    );
    const adminGroup = groups[0].id as number;
    await pool.query(`INSERT INTO group_capabilities (group_id, capability) VALUES ($1, $2)`, [
      adminGroup,
      CAPABILITIES.ADMIN_ALL,
    ]);
    await pool.query(`INSERT INTO permission_group_members (user_id, group_id) VALUES ($1, $2)`, [
      wildcardHolder,
      adminGroup,
    ]);

    const escalation = await a.inject({
      method: "POST",
      url: "/api/permission-groups",
      headers: asUser(manager),
      payload: { name: "forbidden-admin", capabilities: [CAPABILITIES.ADMIN_ALL] },
    });
    expect(escalation.statusCode).toBe(403);

    const patch = await a.inject({
      method: "PATCH",
      url: `/api/permission-groups/${adminGroup}`,
      headers: asUser(manager),
      payload: { description: "must remain wildcard-holder-only" },
    });
    expect(patch.statusCode).toBe(403);

    const lastHolderRemoval = await a.inject({
      method: "DELETE",
      url: `/api/permission-groups/${adminGroup}/members/${wildcardHolder}`,
      headers: asUser(wildcardHolder),
    });
    expect(lastHolderRemoval.statusCode).toBe(409);
  });

  it("fails closed for an anonymized former wildcard holder in a later graph transaction", async () => {
    const a = await getApp();
    const activeWildcard = await wildcardAdmin();
    const formerWildcard = await wildcardAdmin();
    const staff = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET badge_id = 'B-FORMER-WILDCARD' WHERE id = $1`, [
      formerWildcard,
    ]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id)
       VALUES ($1, 'B-FORMER-WILDCARD', $2)`,
      [formerWildcard, staff],
    );

    const anonymized = await a.inject({
      method: "POST",
      url: `/api/users/${formerWildcard}/anonymize`,
      headers: asUser(activeWildcard),
    });
    expect(anonymized.statusCode).toBe(200);

    const { getEffectiveCapabilities, userHasCapability } = await import(
      "../../src/lib/capabilities.js"
    );
    expect(await getEffectiveCapabilities(formerWildcard)).toEqual(new Set());
    expect(await userHasCapability(formerWildcard, CAPABILITIES.ADMIN_ALL)).toBe(false);

    // This models a request that resolved its actor before anonymization and
    // reaches its graph-locked mutation only after that transaction commits.
    const { withTransaction } = await import("../../src/db/pool.js");
    const { requireWildcardGraphAuthority } = await import(
      "../../src/modules/identity/permission-graph.js"
    );
    await expect(
      withTransaction((client) => requireWildcardGraphAuthority(client, formerWildcard)),
    ).rejects.toMatchObject({ statusCode: 403 });

    const escalation = await a.inject({
      method: "POST",
      url: "/api/permission-groups",
      headers: asUser(formerWildcard),
      payload: { name: "anonymized-wildcard-attempt", capabilities: [CAPABILITIES.ADMIN_ALL] },
    });
    // The request is rejected by the verification guard before capability
    // resolution because the anonymized user no longer exists.
    expect(escalation.statusCode).toBe(404);
  });

  it("serializes opposite includes so concurrent requests cannot create a cycle", async () => {
    const a = await getApp();
    const actor = await admin();
    const first = await createGroup(a, actor, "concurrent-first");
    const second = await createGroup(a, actor, "concurrent-second");

    const [firstIncludesSecond, secondIncludesFirst] = await Promise.all([
      a.inject({
        method: "POST",
        url: `/api/permission-groups/${first}/includes`,
        headers: asUser(actor),
        payload: { childGroupId: second },
      }),
      a.inject({
        method: "POST",
        url: `/api/permission-groups/${second}/includes`,
        headers: asUser(actor),
        payload: { childGroupId: first },
      }),
    ]);

    expect([firstIncludesSecond.statusCode, secondIncludesFirst.statusCode].sort()).toEqual([
      200, 409,
    ]);
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT parent_group_id, child_group_id
       FROM permission_group_includes
       WHERE (parent_group_id = $1 AND child_group_id = $2)
          OR (parent_group_id = $2 AND child_group_id = $1)`,
      [first, second],
    );
    expect(rows).toHaveLength(1);
  });

  it("serializes concurrent last-wildcard-holder removals", async () => {
    const a = await getApp();
    const firstHolder = await admin();
    const secondHolder = await admin();
    const { pool } = await import("../../src/db/pool.js");
    const { rows: groups } = await pool.query(
      `INSERT INTO permission_groups (name)
       VALUES ('concurrent-wildcard-a'), ('concurrent-wildcard-b')
       RETURNING id`,
    );
    const [firstGroup, secondGroup] = groups.map((group: { id: number }) => group.id);
    await pool.query(
      `INSERT INTO group_capabilities (group_id, capability)
       VALUES ($1, $3), ($2, $3)`,
      [firstGroup, secondGroup, CAPABILITIES.ADMIN_ALL],
    );
    await pool.query(
      `INSERT INTO permission_group_members (user_id, group_id)
       VALUES ($1, $2), ($3, $4)`,
      [firstHolder, firstGroup, secondHolder, secondGroup],
    );

    const [removeFirst, removeSecond] = await Promise.all([
      a.inject({
        method: "DELETE",
        url: `/api/permission-groups/${firstGroup}/members/${firstHolder}`,
        headers: asUser(firstHolder),
      }),
      a.inject({
        method: "DELETE",
        url: `/api/permission-groups/${secondGroup}/members/${secondHolder}`,
        headers: asUser(secondHolder),
      }),
    ]);

    expect([removeFirst.statusCode, removeSecond.statusCode].sort()).toEqual([200, 409]);
    const { rows: remainingHolders } = await pool.query(
      `SELECT pgm.user_id
       FROM permission_group_members pgm
       JOIN group_capabilities gc ON gc.group_id = pgm.group_id
       WHERE gc.capability = $1`,
      [CAPABILITIES.ADMIN_ALL],
    );
    expect(remainingHolders).toHaveLength(1);
  });

  it("memoizes stacked capability guards only for the active request", async () => {
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const { getEffectiveCapabilities } = await import("../../src/lib/capabilities.js");
    const { pool } = await import("../../src/db/pool.js");
    const query = vi.spyOn(pool, "query");
    const request = {} as FastifyRequest;
    const [first, second] = await Promise.all([
      getEffectiveCapabilities(reader, request),
      getEffectiveCapabilities(reader, request),
    ]);
    expect(first).toEqual(second);
    expect(
      query.mock.calls.filter(([sql]) => String(sql).includes("WITH RECURSIVE user_groups")),
    ).toHaveLength(1);
    query.mockRestore();
  });
});
