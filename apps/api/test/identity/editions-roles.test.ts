import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import {
  assignRole,
  asUser,
  createRole,
  createUser,
  createUserWithCapabilities,
  grantAttendeeRole,
  seedAttendeeRoles,
  useTestApp,
} from "../helpers.js";

/**
 * Multi-edition identity (H8): roles are held per edition, the protected
 * superadmin role is global, the viewed edition (X-Edition) drives /api/me
 * and a closed edition is read-only.
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

async function assignIn(userId: number, roleId: number, eventKey: string) {
  await (await db()).query(
    `INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, $3)`,
    [userId, roleId, eventKey],
  );
}

async function superadmin(): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole([CAPABILITIES.ADMIN_ALL], {
    name: "system:superadmin",
    isProtected: true,
  });
  await (await db()).query(`UPDATE roles SET position = 2000000000 WHERE id = $1`, [roleId]);
  await assignRole(userId, roleId);
  return userId;
}

const me = async (userId: number, edition?: string) => {
  const a = await getApp();
  return a.inject({
    method: "GET",
    url: "/api/me",
    headers: { ...asUser(userId), ...(edition ? { "x-edition": edition } : {}) },
  });
};

describe("roles per edition", () => {
  it("a role held only in e1 gives no capabilities when viewing e2", async () => {
    await createEdition("e2");
    const userId = await createUser();
    const roleId = await createRole([CAPABILITIES.USERS_READ]);
    await assignRole(userId, roleId); // current edition ('default')
    await assignIn(userId, await createRole([]), "e2");

    const current = (await me(userId)).json();
    expect(current.capabilities).toContain(CAPABILITIES.USERS_READ);
    expect(current.edition).toEqual({
      eventKey: "default",
      name: "default",
      status: "active",
      isCurrent: true,
    });

    const other = (await me(userId, "e2")).json();
    expect(other.capabilities).not.toContain(CAPABILITIES.USERS_READ);
    expect(other.hasEventAccess).toBe(true);
    expect(other.edition).toMatchObject({ eventKey: "e2", name: "E2", isCurrent: false });
    // Profile data is global: identical in both editions.
    expect(other.email).toBe(current.email);
  });

  it("a person with no role in the viewed edition looks like an applicant there", async () => {
    await createEdition("e2");
    const userId = await createUser();
    await assignIn(userId, await createRole([CAPABILITIES.USERS_READ]), "e2");
    const current = (await me(userId)).json();
    expect(current.roles).toEqual([]);
    expect(current.capabilities).toEqual([]);
    expect(current.hasEventAccess).toBe(false);
    expect(current.visibleRoleName).toBeNull();
  });

  it("superadmin is global: capabilities in every edition, including closed and draft", async () => {
    await createEdition("e2", "closed");
    await createEdition("e3", "draft");
    const admin = await superadmin();
    for (const key of [undefined, "e2", "e3"]) {
      const res = await me(admin, key);
      expect(res.statusCode).toBe(200);
      expect(res.json().capabilities).toContain(CAPABILITIES.ADMIN_ALL);
    }
    const { rows } = await (await db()).query(
      `SELECT event_key FROM user_roles WHERE user_id = $1`,
      [admin],
    );
    expect(rows).toEqual([{ event_key: null }]);
  });

  it("a closed edition keeps only read capabilities and rejects mutations for a normal admin", async () => {
    await createEdition("e2");
    await seedAttendeeRoles();
    const staff = await createUser();
    const role = await createRole([
      CAPABILITIES.ACCREDIT_SCAN,
      CAPABILITIES.USERS_READ,
      CAPABILITIES.USERS_WRITE,
    ]);
    await assignIn(staff, role, "e2");
    const target = await createUser();
    await grantAttendeeRole(target, "participant");
    await (await db()).query(
      `UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'e2'`,
    );

    const caps = (await me(staff, "e2")).json().capabilities as string[];
    expect(caps).toContain(CAPABILITIES.USERS_READ);
    expect(caps).not.toContain(CAPABILITIES.ACCREDIT_SCAN);

    const a = await getApp();
    const denied = await a.inject({
      method: "PUT",
      url: `/api/users/${target}/attendee-role`,
      headers: { ...asUser(staff), "x-edition": "e2" },
      payload: { role: "mentor" },
    });
    expect(denied.statusCode).toBe(409);
    expect(JSON.stringify(denied.json())).toContain("edition_closed");

    const admin = await superadmin();
    const allowed = await a.inject({
      method: "PUT",
      url: `/api/users/${target}/attendee-role`,
      headers: { ...asUser(admin), "x-edition": "e2" },
      payload: { role: "mentor" },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("validates X-Edition", async () => {
    await createEdition("e2");
    await createEdition("e3", "draft");
    await createEdition("e4");
    const member = await createUser();
    await assignIn(member, await createRole([]), "e2");
    const outsider = await createUser();

    expect((await me(member, "Bad Key!")).statusCode).toBe(400);
    expect((await me(member, "nope")).statusCode).toBe(404);
    expect((await me(member, "e3")).statusCode).toBe(403);
    expect((await me(member, "e4")).statusCode).toBe(403);
    expect((await me(member, "e2")).statusCode).toBe(200);
    // The current edition is always allowed, with or without participation.
    expect((await me(outsider, "default")).statusCode).toBe(200);
    expect((await me(outsider)).statusCode).toBe(200);
  });
});

describe("role management is scoped to the viewed edition", () => {
  it("assigning in e2 does not affect e1 and removing in e2 leaves the e1 row", async () => {
    await createEdition("e2");
    const a = await getApp();
    const admin = await superadmin();
    const roleId = await createRole([CAPABILITIES.USERS_READ]);
    const userId = await createUser();
    await assignRole(userId, roleId); // e1 ('default')

    const headers = { ...asUser(admin), "x-edition": "e2" };
    const added = await a.inject({
      method: "POST",
      url: `/api/roles/${roleId}/users/${userId}`,
      headers,
    });
    expect(added.statusCode).toBe(200);
    const pool = await db();
    const rowsOf = async () =>
      (
        await pool.query(`SELECT event_key FROM user_roles WHERE user_id = $1 ORDER BY 1`, [userId])
      ).rows.map((r: { event_key: string }) => r.event_key);
    expect(await rowsOf()).toEqual(["default", "e2"]);

    const removed = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}/users/${userId}`,
      headers,
    });
    expect(removed.statusCode).toBe(200);
    expect(await rowsOf()).toEqual(["default"]);

    // Role assignment made without the header lands in e1 only.
    const other = await createUser();
    await a.inject({
      method: "POST",
      url: `/api/roles/${roleId}/users/${other}`,
      headers: asUser(admin),
    });
    const { rows } = await pool.query(`SELECT event_key FROM user_roles WHERE user_id = $1`, [
      other,
    ]);
    expect(rows).toEqual([{ event_key: "default" }]);
  });

  it("GET /api/users/:id/roles lists the viewed edition's roles", async () => {
    await createEdition("e2");
    const a = await getApp();
    const admin = await superadmin();
    const userId = await createUser();
    const r1 = await createRole([], { name: "only-e1" });
    const r2 = await createRole([], { name: "only-e2" });
    await assignRole(userId, r1);
    await assignIn(userId, r2, "e2");
    const names = async (edition?: string) =>
      (
        await a.inject({
          method: "GET",
          url: `/api/users/${userId}/roles`,
          headers: { ...asUser(admin), ...(edition ? { "x-edition": edition } : {}) },
        })
      )
        .json()
        .map((r: { name: string }) => r.name);
    expect(await names()).toEqual(["only-e1"]);
    expect(await names("e2")).toEqual(["only-e2"]);
  });
});

describe("invite redemption", () => {
  it("assigns the invite's roles in the current edition at redemption time", async () => {
    await createEdition("e2");
    const a = await getApp();
    const inviter = await createUserWithCapabilities([CAPABILITIES.INVITES_MANAGE]);
    const roleId = await createRole([]);
    const created = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(inviter),
      payload: { email: "ed-invite@example.com", kind: "staff", roleIds: [roleId] },
    });
    expect(created.statusCode).toBe(201);
    const pool = await db();
    // The current edition moves on before the invite is redeemed.
    await pool.query(
      `INSERT INTO event_config (id, event_key) VALUES (1, 'e2')
       ON CONFLICT (id) DO UPDATE SET event_key = 'e2'`,
    );
    const accepted = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        token: created.json().token,
        name: "Ed",
        surname: "Invitee",
        password: "password-1234",
        shirtSize: "M",
      },
    });
    expect(accepted.statusCode).toBe(201);
    const { rows } = await pool.query(
      `SELECT event_key FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [accepted.json().userId, roleId],
    );
    expect(rows).toEqual([{ event_key: "e2" }]);
  });
});
