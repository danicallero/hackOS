import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  assignRole,
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { TEST_DATABASE_URL } from "../test-env.js";

/**
 * H8: the Discord-style hierarchical role model — tri-state (ALLOW/DENY/
 * INHERIT) resolution over a user's own assigned roles, admin-hierarchy
 * mutation authority, and the roles CRUD/assignment API that replaced
 * capability-group management.
 */

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

async function manager(): Promise<number> {
  return createUserWithCapabilities([CAPABILITIES.PERMISSIONS_MANAGE]);
}

describe("H8 role resolution semantics", () => {
  it("ALLOW on the highest-position role the user holds wins", async () => {
    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    const userId = await createUser();
    const denyRole = await createRole([]);
    const allowRole = await createRole([]);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE roles SET position = 200 WHERE id = $1`, [denyRole]);
    await pool.query(`UPDATE roles SET position = 100 WHERE id = $1`, [allowRole]);
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, 'deny')`,
      [denyRole, CAPABILITIES.USERS_READ],
    );
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, 'allow')`,
      [allowRole, CAPABILITIES.USERS_READ],
    );
    await assignRole(userId, denyRole);
    await assignRole(userId, allowRole);

    // The higher-position role (denyRole, position 200) DENYs — it must
    // short-circuit before ever considering allowRole (position 100).
    expect(await userHasCapability(userId, CAPABILITIES.USERS_READ)).toBe(false);
  });

  it("DENY short-circuits regardless of a lower ALLOW", async () => {
    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    const { pool } = await import("../../src/db/pool.js");
    const userId = await createUser();
    const higher = await createRole([]);
    const lower = await createRole([CAPABILITIES.USERS_READ]);
    await pool.query(`UPDATE roles SET position = 500 WHERE id = $1`, [higher]);
    await pool.query(`UPDATE roles SET position = 100 WHERE id = $1`, [lower]);
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, 'deny')`,
      [higher, CAPABILITIES.USERS_READ],
    );
    await assignRole(userId, higher);
    await assignRole(userId, lower);
    expect(await userHasCapability(userId, CAPABILITIES.USERS_READ)).toBe(false);
  });

  it("INHERIT skips to the next-lower-position role the user ALSO holds, not the global next role", async () => {
    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    const { pool } = await import("../../src/db/pool.js");
    const userId = await createUser();
    // A global role between `top` and `bottom` that the user does NOT hold,
    // carrying a DENY — it must be invisible to this user's chain.
    const top = await createRole([]);
    const globalMiddleNotHeld = await createRole([]);
    const bottom = await createRole([CAPABILITIES.USERS_READ]);
    await pool.query(`UPDATE roles SET position = 300 WHERE id = $1`, [top]);
    await pool.query(`UPDATE roles SET position = 200 WHERE id = $1`, [globalMiddleNotHeld]);
    await pool.query(`UPDATE roles SET position = 100 WHERE id = $1`, [bottom]);
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, 'deny')`,
      [globalMiddleNotHeld, CAPABILITIES.USERS_READ],
    );
    await assignRole(userId, top);
    await assignRole(userId, bottom);
    // top is INHERIT (no row) -> skip straight to bottom (ALLOW), never
    // touching globalMiddleNotHeld's DENY since the user doesn't hold it.
    expect(await userHasCapability(userId, CAPABILITIES.USERS_READ)).toBe(true);
  });

  it("an all-INHERIT chain denies", async () => {
    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    const userId = await createUser();
    const roleA = await createRole([]);
    const roleB = await createRole([]);
    await assignRole(userId, roleA);
    await assignRole(userId, roleB);
    expect(await userHasCapability(userId, CAPABILITIES.USERS_READ)).toBe(false);
  });

  it("a user with no roles is denied everything", async () => {
    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    const userId = await createUser();
    expect(await userHasCapability(userId, CAPABILITIES.USERS_READ)).toBe(false);
    expect(await userHasCapability(userId, CAPABILITIES.ADMIN_ALL)).toBe(false);
  });

  it("'*' still grants every capability", async () => {
    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    expect(await userHasCapability(admin, CAPABILITIES.QUEUE_ADMIN)).toBe(true);
    expect(await userHasCapability(admin, CAPABILITIES.AUDIT_READ)).toBe(true);
  });
});

describe("H8 admin-hierarchy mutation authority", () => {
  it("an actor can manage only strictly-lower-position roles", async () => {
    const a = await getApp();
    const midManager = await createUserWithCapabilities([CAPABILITIES.PERMISSIONS_MANAGE]);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 500 WHERE id = (
      SELECT role_id FROM user_roles WHERE user_id = $1
    )`,
      [midManager],
    );

    const lower = await a.inject({
      method: "POST",
      url: "/api/roles",
      headers: asUser(midManager),
      payload: { name: "lower-role", position: 100 },
    });
    expect(lower.statusCode).toBe(201);

    const equal = await a.inject({
      method: "POST",
      url: "/api/roles",
      headers: asUser(midManager),
      payload: { name: "equal-role", position: 500 },
    });
    expect(equal.statusCode).toBe(403);

    const higher = await a.inject({
      method: "POST",
      url: "/api/roles",
      headers: asUser(midManager),
      payload: { name: "higher-role", position: 900 },
    });
    expect(higher.statusCode).toBe(403);
  });

  it("cannot reorder a role so its new position ends up at or above the actor's highest", async () => {
    const a = await getApp();
    const actor = await createUserWithCapabilities([CAPABILITIES.PERMISSIONS_MANAGE]);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 500 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );
    const targetRole = await createRole([], { name: "reorder-target" });
    await pool.query(`UPDATE roles SET position = 100 WHERE id = $1`, [targetRole]);

    const selfElevate = await a.inject({
      method: "PATCH",
      url: `/api/roles/${targetRole}/position`,
      headers: asUser(actor),
      payload: { position: 500 },
    });
    expect(selfElevate.statusCode).toBe(403);

    const escalate = await a.inject({
      method: "PATCH",
      url: `/api/roles/${targetRole}/position`,
      headers: asUser(actor),
      payload: { position: 800 },
    });
    expect(escalate.statusCode).toBe(403);

    const fine = await a.inject({
      method: "PATCH",
      url: `/api/roles/${targetRole}/position`,
      headers: asUser(actor),
      payload: { position: 200 },
    });
    expect(fine.statusCode).toBe(200);
    expect(fine.json().position).toBe(200);
  });

  it("blocks self-role-elevation: assigning a role at/above the actor's own highest", async () => {
    const a = await getApp();
    const actor = await createUserWithCapabilities([CAPABILITIES.PERMISSIONS_MANAGE]);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 500 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );
    const higherRole = await createRole([], { name: "self-elevate-target" });
    await pool.query(`UPDATE roles SET position = 600 WHERE id = $1`, [higherRole]);

    const res = await a.inject({
      method: "POST",
      url: `/api/roles/${higherRole}/users/${actor}`,
      headers: asUser(actor),
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires PERMISSIONS_MANAGE on mutating routes", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const res = await a.inject({
      method: "POST",
      url: "/api/roles",
      headers: asUser(pleb),
      payload: { name: "nope", position: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("keeps at least one active wildcard holder", async () => {
    const a = await getApp();
    const wildcardHolder = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT role_id, position FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [wildcardHolder],
    );
    const roleId = rows[0].role_id as number;
    const rolePosition = rows[0].position as number;

    // A distinct, even-higher actor — the sole wildcard holder can never
    // manage their own role (self-management is blocked at the ceiling), so
    // this invariant is only reachable from strictly above.
    const topActor = await createUserWithCapabilities([CAPABILITIES.PERMISSIONS_MANAGE]);
    await pool.query(
      `UPDATE roles SET position = $2 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [topActor, rolePosition + 1000],
    );

    const removal = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}/users/${wildcardHolder}`,
      headers: asUser(topActor),
    });
    expect(removal.statusCode).toBe(409);
  });
});

describe("H8 roles CRUD and assignment API", () => {
  it("creates, edits capabilities, reorders, and deletes a role with audit rows", async () => {
    const a = await getApp();
    // Also holds ACCREDIT_SCAN itself: the H8 capability-possession guard
    // requires an actor to already possess a capability before granting it
    // to (or assigning a role that grants it to) someone else.
    const actor = await createUserWithCapabilities([
      CAPABILITIES.PERMISSIONS_MANAGE,
      CAPABILITIES.ACCREDIT_SCAN,
    ]);
    const { pool } = await import("../../src/db/pool.js");
    // Give this manager a very high position so it can manage the roles it creates.
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id IN (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );

    const created = await a.inject({
      method: "POST",
      url: "/api/roles",
      headers: asUser(actor),
      payload: { name: "scanners", position: 10, capabilities: [] },
    });
    expect(created.statusCode).toBe(201);
    const roleId = created.json().id as number;

    const capsSet = await a.inject({
      method: "PUT",
      url: `/api/roles/${roleId}/capabilities`,
      headers: asUser(actor),
      payload: { capabilities: [{ capability: CAPABILITIES.ACCREDIT_SCAN, state: "allow" }] },
    });
    expect(capsSet.statusCode).toBe(200);
    expect(capsSet.json().capabilities).toEqual([
      { capability: CAPABILITIES.ACCREDIT_SCAN, state: "allow" },
    ]);

    const reordered = await a.inject({
      method: "PATCH",
      url: `/api/roles/${roleId}/position`,
      headers: asUser(actor),
      payload: { position: 20 },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().position).toBe(20);

    const member = await createUser();
    const assigned = await a.inject({
      method: "POST",
      url: `/api/roles/${roleId}/users/${member}`,
      headers: asUser(actor),
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().memberIds).toContain(member);

    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    expect(await userHasCapability(member, CAPABILITIES.ACCREDIT_SCAN)).toBe(true);

    const removed = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}/users/${member}`,
      headers: asUser(actor),
    });
    expect(removed.statusCode).toBe(200);
    expect(await userHasCapability(member, CAPABILITIES.ACCREDIT_SCAN)).toBe(false);

    const deleted = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}`,
      headers: asUser(actor),
    });
    expect(deleted.statusCode).toBe(200);

    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'role' AND entity_id = $1 ORDER BY id`,
      [String(roleId)],
    );
    expect(rows.map((r: { action: string }) => r.action)).toEqual([
      "create",
      "set_capabilities",
      "reorder",
      "assign_user",
      "remove_user",
      "soft_delete",
    ]);
  });

  it("a position collision on reorder 409s", async () => {
    const a = await getApp();
    const actor = await manager();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );
    const roleA = await createRole([], { name: "collide-a" });
    const roleB = await createRole([], { name: "collide-b" });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [roleA]);
    await pool.query(`UPDATE roles SET position = 20 WHERE id = $1`, [roleB]);

    const res = await a.inject({
      method: "PATCH",
      url: `/api/roles/${roleB}/position`,
      headers: asUser(actor),
      payload: { position: 10 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("serializes two concurrent reorders onto the same position: exactly one wins", async () => {
    const a = await getApp();
    const actor = await manager();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );
    const roleA = await createRole([], { name: "race-a" });
    const roleB = await createRole([], { name: "race-b" });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [roleA]);
    await pool.query(`UPDATE roles SET position = 20 WHERE id = $1`, [roleB]);

    const [first, second] = await Promise.all([
      a.inject({
        method: "PATCH",
        url: `/api/roles/${roleA}/position`,
        headers: asUser(actor),
        payload: { position: 999 },
      }),
      a.inject({
        method: "PATCH",
        url: `/api/roles/${roleB}/position`,
        headers: asUser(actor),
        payload: { position: 999 },
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM roles WHERE position = 999`);
    expect(rows[0].n).toBe(1);
  });
});

describe("H8 sponsor auto-grant rule and application-confirmation role grant", () => {
  it("grants and revokes the Sponsor role through role_grant_rules on enterprise link/unlink", async () => {
    const { pool, withTransaction } = await import("../../src/db/pool.js");
    const { applyRoleGrantRule } = await import("../../src/modules/identity/role-grants.js");
    const sponsorRole = await createRole([], { name: "Sponsor" });
    await pool.query(
      `INSERT INTO role_grant_rules (role_id, trigger_event, action) VALUES ($1, 'sponsor.enterprise_linked', 'grant')`,
      [sponsorRole],
    );
    await pool.query(
      `INSERT INTO role_grant_rules (role_id, trigger_event, action) VALUES ($1, 'sponsor.enterprise_unlinked', 'revoke')`,
      [sponsorRole],
    );
    const userId = await createUser();

    await withTransaction((client) =>
      applyRoleGrantRule(client, userId, "sponsor.enterprise_linked", null),
    );
    const { rows: afterGrant } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, sponsorRole],
    );
    expect(afterGrant).toHaveLength(1);

    await withTransaction((client) =>
      applyRoleGrantRule(client, userId, "sponsor.enterprise_unlinked", null),
    );
    const { rows: afterRevoke } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, sponsorRole],
    );
    expect(afterRevoke).toHaveLength(0);
  });

  it("grants a form's configured role on confirmation, alongside ticket issuance", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const grantedRole = await createRole([], { name: "confirmed-applicant-role" });

    const { rows: appRows } = await pool.query(
      `INSERT INTO applications
         (name, type, template, sections, active, confirmation_window_hours, current_form_version, grants_role_id)
       VALUES ('Test form', 'participant', '[]'::jsonb, '[]'::jsonb, true, 168, 1, $1)
       RETURNING id`,
      [grantedRole],
    );
    const applicationId = appRows[0].id as number;
    const { ensureApplicationFormVersion } = await import("../helpers.js");
    const formVersionId = await ensureApplicationFormVersion(applicationId);
    const userId = await createUser({ email: "confirm-role-grant@test.local" });
    const { rows: tokenRows } = await pool.query(
      `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
       VALUES ($1, 'spot_confirmation', $2, $3, now() + interval '1 day')
       RETURNING id`,
      [`test-confirm-token-${userId}`, "confirm-role-grant@test.local", userId],
    );
    const { rows: respRows } = await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, confirmation_token_id)
       VALUES ($1, $2, $3, 'accepted', $4) RETURNING id`,
      [userId, applicationId, formVersionId, tokenRows[0].id],
    );
    const responseId = respRows[0].id as number;

    const { confirmByResponseId } = await import("../../src/modules/applications/service.js");
    await confirmByResponseId(responseId, "admin_override", null);

    const { rows: roleRows } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, grantedRole],
    );
    expect(roleRows).toHaveLength(1);
    const { rows: ticketRows } = await pool.query(`SELECT 1 FROM tickets WHERE user_id = $1`, [
      userId,
    ]);
    expect(ticketRows).toHaveLength(1);
  });
});

describe("H8 system:superadmin is CLI-only", () => {
  async function superadminSetup() {
    const { pool } = await import("../../src/db/pool.js");
    const roleId = await createRole([CAPABILITIES.ADMIN_ALL], {
      name: "system:superadmin",
      isProtected: true,
    });
    await pool.query(`UPDATE roles SET position = 999999999 WHERE id = $1`, [roleId]);
    const holder = await createUser();
    await assignRole(holder, roleId);
    // A distinct '*' holder to act as the API caller — even wielding '*'
    // itself, it must never be able to touch system:superadmin over HTTP.
    const wildcardActor = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    return { roleId, holder, wildcardActor };
  }

  it("cannot be assigned to a user via the API, even by a wildcard-holding actor", async () => {
    const a = await getApp();
    const { roleId, wildcardActor } = await superadminSetup();
    const target = await createUser();
    const res = await a.inject({
      method: "POST",
      url: `/api/roles/${roleId}/users/${target}`,
      headers: asUser(wildcardActor),
    });
    expect(res.statusCode).toBe(403);
  });

  it("cannot be removed from a user via the API, even by a wildcard-holding actor", async () => {
    const a = await getApp();
    const { roleId, holder, wildcardActor } = await superadminSetup();
    const res = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}/users/${holder}`,
      headers: asUser(wildcardActor),
    });
    expect(res.statusCode).toBe(403);
  });

  it("cannot be renamed, reordered, or have its capabilities edited via the API", async () => {
    const a = await getApp();
    const { roleId, wildcardActor } = await superadminSetup();

    const rename = await a.inject({
      method: "PATCH",
      url: `/api/roles/${roleId}`,
      headers: asUser(wildcardActor),
      payload: { name: "renamed" },
    });
    expect(rename.statusCode).toBe(403);

    const reorder = await a.inject({
      method: "PATCH",
      url: `/api/roles/${roleId}/position`,
      headers: asUser(wildcardActor),
      payload: { position: 1 },
    });
    expect(reorder.statusCode).toBe(403);

    const caps = await a.inject({
      method: "PUT",
      url: `/api/roles/${roleId}/capabilities`,
      headers: asUser(wildcardActor),
      payload: { capabilities: [{ capability: CAPABILITIES.USERS_READ, state: "allow" }] },
    });
    expect(caps.statusCode).toBe(403);
  });

  it("cannot be deleted via the API", async () => {
    const a = await getApp();
    const { roleId, wildcardActor } = await superadminSetup();
    const res = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}`,
      headers: asUser(wildcardActor),
    });
    expect(res.statusCode).toBe(403);
  });

  it("cannot be minted under this name via role creation", async () => {
    const a = await getApp();
    const actor = await manager();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );
    const res = await a.inject({
      method: "POST",
      url: "/api/roles",
      headers: asUser(actor),
      payload: { name: "system:superadmin", position: 10 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("H8 role soft-delete and restore", () => {
  it("a soft-deleted role stops granting access immediately, and restore brings it back", async () => {
    const a = await getApp();
    const actor = await manager();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );
    const roleId = await createRole([CAPABILITIES.USERS_READ], { name: "soft-delete-target" });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [roleId]);
    const member = await createUser();
    await assignRole(member, roleId);

    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    expect(await userHasCapability(member, CAPABILITIES.USERS_READ)).toBe(true);

    const del = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}`,
      headers: asUser(actor),
    });
    expect(del.statusCode).toBe(200);
    expect(await userHasCapability(member, CAPABILITIES.USERS_READ)).toBe(false);

    // Hidden from the default listing, but still loadable by id and via
    // includeDeleted for a trash/restore panel.
    const list = await a.inject({ method: "GET", url: "/api/roles", headers: asUser(actor) });
    expect(list.json().map((r: { id: number }) => r.id)).not.toContain(roleId);
    const listWithDeleted = await a.inject({
      method: "GET",
      url: "/api/roles?includeDeleted=true",
      headers: asUser(actor),
    });
    expect(listWithDeleted.json().map((r: { id: number }) => r.id)).toContain(roleId);

    const restored = await a.inject({
      method: "POST",
      url: `/api/roles/${roleId}/restore`,
      headers: asUser(actor),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().deletedAt).toBeNull();
    expect(await userHasCapability(member, CAPABILITIES.USERS_READ)).toBe(true);
  });

  it("restore 409s if another role has since taken the deleted role's exact position", async () => {
    const a = await getApp();
    const actor = await manager();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );
    const roleId = await createRole([], { name: "position-conflict-target" });
    await pool.query(`UPDATE roles SET position = 42 WHERE id = $1`, [roleId]);

    const del = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}`,
      headers: asUser(actor),
    });
    expect(del.statusCode).toBe(200);

    // Another role takes the exact same slot while the first is in the trash.
    const collider = await createRole([], { name: "position-conflict-collider" });
    await pool.query(`UPDATE roles SET position = 42 WHERE id = $1`, [collider]);

    const restore = await a.inject({
      method: "POST",
      url: `/api/roles/${roleId}/restore`,
      headers: asUser(actor),
    });
    expect(restore.statusCode).toBe(409);
  });

  it("deleting a role removing the last wildcard holder still enforces the active-wildcard-holder invariant", async () => {
    const a = await getApp();
    const wildcardHolder = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT role_id, position FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [wildcardHolder],
    );
    const roleId = rows[0].role_id as number;
    const rolePosition = rows[0].position as number;
    const topActor = await createUserWithCapabilities([CAPABILITIES.PERMISSIONS_MANAGE]);
    await pool.query(
      `UPDATE roles SET position = $2 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [topActor, rolePosition + 1000],
    );

    const res = await a.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}`,
      headers: asUser(topActor),
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("H8 capability-possession authority (independent of the position guard)", () => {
  // A high-position PERMISSIONS_MANAGE holder, optionally with extra
  // capabilities — isolates the capability-possession guard from the
  // separate admin-hierarchy position check (both must pass independently).
  async function highPositionManager(extraCapabilities: string[] = []): Promise<number> {
    const actor = await createUserWithCapabilities([
      CAPABILITIES.PERMISSIONS_MANAGE,
      ...extraCapabilities,
    ]);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id IN (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );
    return actor;
  }

  it("cannot set a role's capability to ALLOW unless the actor possesses it themselves", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const actor = await highPositionManager();
    const role = await createRole([], { name: "possession-allow-target" });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [role]);

    const res = await a.inject({
      method: "PUT",
      url: `/api/roles/${role}/capabilities`,
      headers: asUser(actor),
      payload: { capabilities: [{ capability: CAPABILITIES.ACCREDIT_SCAN, state: "allow" }] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/possess/i);
  });

  it("cannot set a role's capability to DENY unless the actor possesses it themselves", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const actor = await highPositionManager();
    const role = await createRole([], { name: "possession-deny-target" });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [role]);

    const res = await a.inject({
      method: "PUT",
      url: `/api/roles/${role}/capabilities`,
      headers: asUser(actor),
      payload: { capabilities: [{ capability: CAPABILITIES.ACCREDIT_SCAN, state: "deny" }] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/possess/i);
  });

  it("can set a role's capability to INHERIT regardless of possession", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const actor = await highPositionManager();
    const role = await createRole([CAPABILITIES.ACCREDIT_SCAN], {
      name: "possession-inherit-target",
    });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [role]);

    const res = await a.inject({
      method: "PUT",
      url: `/api/roles/${role}/capabilities`,
      headers: asUser(actor),
      payload: { capabilities: [{ capability: CAPABILITIES.ACCREDIT_SCAN, state: "inherit" }] },
    });
    expect(res.statusCode).toBe(200);
  });

  it("can set ALLOW/DENY once the actor already possesses that capability", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const actor = await highPositionManager([CAPABILITIES.ACCREDIT_SCAN]);
    const role = await createRole([], { name: "possession-allow-ok-target" });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [role]);

    const res = await a.inject({
      method: "PUT",
      url: `/api/roles/${role}/capabilities`,
      headers: asUser(actor),
      payload: { capabilities: [{ capability: CAPABILITIES.ACCREDIT_SCAN, state: "allow" }] },
    });
    expect(res.statusCode).toBe(200);
  });

  it("cannot assign a role to a user if it has an explicit-ALLOW capability the actor doesn't possess", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const actor = await highPositionManager();
    const role = await createRole([CAPABILITIES.ACCREDIT_SCAN], {
      name: "possession-assign-blocked-target",
    });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [role]);
    const target = await createUser();

    const res = await a.inject({
      method: "POST",
      url: `/api/roles/${role}/users/${target}`,
      headers: asUser(actor),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/possess/i);
  });

  it("can assign a role whose explicit ALLOWs are a subset of the actor's own capabilities", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const actor = await highPositionManager([CAPABILITIES.ACCREDIT_SCAN]);
    const role = await createRole([CAPABILITIES.ACCREDIT_SCAN], {
      name: "possession-assign-ok-target",
    });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [role]);
    const target = await createUser();

    const res = await a.inject({
      method: "POST",
      url: `/api/roles/${role}/users/${target}`,
      headers: asUser(actor),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().memberIds).toContain(target);
  });

  it("a wildcard ('*') holder is exempt from the possession guard entirely", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const actor = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id IN (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [actor],
    );

    const capRole = await createRole([], { name: "possession-wildcard-caps-target" });
    await pool.query(`UPDATE roles SET position = 10 WHERE id = $1`, [capRole]);
    const capsRes = await a.inject({
      method: "PUT",
      url: `/api/roles/${capRole}/capabilities`,
      headers: asUser(actor),
      payload: { capabilities: [{ capability: CAPABILITIES.ACCREDIT_SCAN, state: "allow" }] },
    });
    expect(capsRes.statusCode).toBe(200);

    const assignRoleTarget = await createRole([CAPABILITIES.ACCREDIT_SCAN], {
      name: "possession-wildcard-assign-target",
    });
    await pool.query(`UPDATE roles SET position = 11 WHERE id = $1`, [assignRoleTarget]);
    const target = await createUser();
    const assignRes = await a.inject({
      method: "POST",
      url: `/api/roles/${assignRoleTarget}/users/${target}`,
      headers: asUser(actor),
    });
    expect(assignRes.statusCode).toBe(200);
  });
});

describe("H8 default seeded role set (0805)", () => {
  // roles.test.ts's beforeEach truncates every table (test/helpers.ts's
  // truncateAll), which wipes migration-seeded rows along with everything
  // else — so this suite can't just query the shared test database the way
  // the rest of this file does. Instead it migrates a throwaway database of
  // its own and inspects that, mirroring test/migrations.test.ts's pattern.
  let seedPool: import("pg").Pool | undefined;

  afterAll(async () => {
    await seedPool?.end();
  });

  async function seededRoles() {
    if (!seedPool) {
      const { randomUUID } = await import("node:crypto");
      const pgModule = await import("pg");
      const { migrate } = await import("../../scripts/migrate.js");
      const dbName = `hackos_roles_seed_${process.pid}_${randomUUID().replaceAll("-", "")}`;
      const adminUrl = new URL(TEST_DATABASE_URL);
      adminUrl.pathname = "/postgres";
      const admin = new pgModule.default.Client({ connectionString: adminUrl.toString() });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${dbName}"`);
      await admin.end();
      const dbUrl = new URL(TEST_DATABASE_URL);
      dbUrl.pathname = `/${dbName}`;
      await migrate(dbUrl.toString());
      seedPool = new pgModule.default.Pool({ connectionString: dbUrl.toString() });
    }
    return seedPool;
  }

  it("seeds the composable default catalogue with real, exact capability grants per role", async () => {
    const pool = await seededRoles();
    const eventDirectorCaps = Object.values(CAPABILITIES).filter(
      (cap) => cap !== CAPABILITIES.ADMIN_ALL && cap !== CAPABILITIES.SPONSOR_PORTAL,
    );
    const expected: Record<string, string[]> = {
      "Event Director": eventDirectorCaps,
      Organizer: [
        CAPABILITIES.USERS_READ,
        CAPABILITIES.APPLICATIONS_REVIEW,
        CAPABILITIES.PROJECTS_READ,
        CAPABILITIES.ACCREDIT_SCAN,
        CAPABILITIES.PRESENCE_SCAN,
        CAPABILITIES.ACTIVITY_SCAN,
        CAPABILITIES.LOGISTICS_STATS,
      ],
      "Day Staff": [
        CAPABILITIES.ACCREDIT_SCAN,
        CAPABILITIES.PRESENCE_SCAN,
        CAPABILITIES.ACTIVITY_SCAN,
        CAPABILITIES.LOGISTICS_STATS,
      ],
      "Applications Team": [CAPABILITIES.APPLICATIONS_MANAGE, CAPABILITIES.APPLICATIONS_REVIEW],
      "Applications Lead": [
        CAPABILITIES.APPLICATIONS_DECIDE,
        CAPABILITIES.APPLICATIONS_EDIT_RESPONSE,
      ],
      "Operations Team": [
        CAPABILITIES.ACCREDIT_SCAN,
        CAPABILITIES.PRESENCE_SCAN,
        CAPABILITIES.ACTIVITY_SCAN,
        CAPABILITIES.LOGISTICS_STATS,
        CAPABILITIES.INTOLERANCES_MANAGE,
        CAPABILITIES.VENUE_MANAGE,
        CAPABILITIES.PRESENCE_MANAGE,
      ],
      "Hacker Experience": [
        CAPABILITIES.PROJECTS_READ,
        CAPABILITIES.ACTIVITY_SCAN,
        CAPABILITIES.SCHEDULE_MANAGE,
        CAPABILITIES.TV_CONTROL,
        CAPABILITIES.CHALLENGES_MANAGE,
      ],
      "Sponsors Team": [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.CHALLENGES_MANAGE],
      "Judging Team": [
        CAPABILITIES.PROJECTS_READ,
        CAPABILITIES.PROJECTS_IMPORT,
        CAPABILITIES.PROJECTS_EDIT,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.JUDGE_PANEL,
      ],
      "Judging Coordinator": [CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.JUDGING_EXPORT],
      "Media / Comms": [
        CAPABILITIES.SCHEDULE_MANAGE,
        CAPABILITIES.ANNOUNCEMENTS_MANAGE,
        CAPABILITIES.TV_CONTROL,
      ],
      "Technical Team": [
        CAPABILITIES.USERS_READ,
        CAPABILITIES.USERS_WRITE,
        CAPABILITIES.AUDIT_READ,
      ],
      Mentor: [],
      Participant: [],
    };
    for (const [name, caps] of Object.entries(expected)) {
      const { rows: roleRows } = await pool.query(
        `SELECT id, is_protected, deleted_at FROM roles WHERE name = $1`,
        [name],
      );
      expect(roleRows, `role "${name}" should exist`).toHaveLength(1);
      expect(roleRows[0].is_protected).toBe(false);
      expect(roleRows[0].deleted_at).toBeNull();
      const { rows: capRows } = await pool.query(
        `SELECT capability FROM role_capabilities WHERE role_id = $1 AND state = 'allow' ORDER BY capability`,
        [roleRows[0].id],
      );
      expect(capRows.map((r: { capability: string }) => r.capability).sort()).toEqual(
        [...caps].sort(),
      );
    }
  });

  it("concentrates decide/override/broadcast capabilities at Event Director, not any functional team role (H8 risk tiering)", async () => {
    const pool = await seededRoles();
    const riskyCapabilities = [
      CAPABILITIES.APPLICATIONS_DECIDE,
      CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE,
      CAPABILITIES.NOTIFICATIONS_SEND,
      CAPABILITIES.ANNOUNCEMENTS_MANAGE,
    ];
    const { rows } = await pool.query(
      `SELECT r.name, rc.capability
         FROM role_capabilities rc
         JOIN roles r ON r.id = rc.role_id
        WHERE rc.state = 'allow' AND rc.capability = ANY($1::text[])
        ORDER BY r.name, rc.capability`,
      [riskyCapabilities],
    );
    const byRole = new Map<string, string[]>();
    for (const row of rows as { name: string; capability: string }[]) {
      byRole.set(row.name, [...(byRole.get(row.name) ?? []), row.capability]);
    }
    // applications:confirm-override and notifications:send are Event
    // Director exclusives; announcements:manage is also legitimately held by
    // Media / Comms, and applications:decide by Applications Lead — both by
    // deliberate composable-role design, not a risk-tiering leak.
    expect([...byRole.keys()].sort()).toEqual(
      ["Applications Lead", "Event Director", "Media / Comms"].sort(),
    );
    expect(byRole.get("Event Director")?.sort()).toEqual(
      [
        CAPABILITIES.ANNOUNCEMENTS_MANAGE,
        CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE,
        CAPABILITIES.APPLICATIONS_DECIDE,
        CAPABILITIES.NOTIFICATIONS_SEND,
      ].sort(),
    );
    expect(byRole.get("Applications Lead")).toEqual([CAPABILITIES.APPLICATIONS_DECIDE]);
    expect(byRole.get("Media / Comms")).toEqual([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);

    // applications:confirm-override and notifications:send never leak below
    // Event Director.
    const { rows: overrideHolders } = await pool.query(
      `SELECT r.name FROM role_capabilities rc
         JOIN roles r ON r.id = rc.role_id
        WHERE rc.state = 'allow'
          AND rc.capability = ANY($1::text[])`,
      [[CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE, CAPABILITIES.NOTIFICATIONS_SEND]],
    );
    expect(new Set(overrideHolders.map((r: { name: string }) => r.name))).toEqual(
      new Set(["Event Director"]),
    );
  });

  it("seeds zero legacy H8 template roles on a fresh install (0801 only ports pre-existing permission_groups data)", async () => {
    const pool = await seededRoles();
    const legacyTemplateRoleNames = [
      "Platform administrator",
      "Access administrator",
      "Application supervisor",
      "Application decisions",
      "Application reviewer",
      "Application builder",
      "Judging administrator",
      "Queue operator",
      "Project operator",
      "Logistics supervisor",
      "Accreditation station",
      "Presence station",
      "Activity and meal station",
      "Programme manager",
      "Event settings manager",
      "TV operator",
      "Sponsor administrator",
      "Communications manager",
      "Data auditor",
      "Content library manager",
    ];
    const { rows } = await pool.query(`SELECT name FROM roles WHERE name = ANY($1::text[])`, [
      legacyTemplateRoleNames,
    ]);
    expect(rows).toHaveLength(0);

    // Also confirm the OLD (superseded) six-role draft catalogue is gone.
    const { rows: oldDraftRows } = await pool.query(
      `SELECT name FROM roles WHERE name = ANY($1::text[])`,
      [["Event director", "Judge coordinator", "Operations lead", "Volunteer staff"]],
    );
    expect(oldDraftRows).toHaveLength(0);

    // Total default set on a fresh install: 0805's fifteen roles + 0801's
    // always-created Sponsor role. system:superadmin is CLI-only, never
    // created by migrations.
    const { rows: allRoles } = await pool.query(`SELECT name FROM roles ORDER BY name`);
    expect(allRoles.map((r: { name: string }) => r.name).sort()).toEqual(
      [
        "Event Director",
        "Organizer",
        "Day Staff",
        "Applications Team",
        "Applications Lead",
        "Operations Team",
        "Hacker Experience",
        "Sponsors Team",
        "Judging Team",
        "Judging Coordinator",
        "Media / Comms",
        "Technical Team",
        "Mentor",
        "Participant",
        "Sponsor",
      ].sort(),
    );
  });

  it("keeps the existing Sponsor auto-grant role capability-less and positioned below the functional team roles", async () => {
    const pool = await seededRoles();
    const { rows } = await pool.query(`SELECT id, position FROM roles WHERE name = 'Sponsor'`);
    expect(rows).toHaveLength(1);
    const { rows: capRows } = await pool.query(
      `SELECT 1 FROM role_capabilities WHERE role_id = $1`,
      [rows[0].id],
    );
    expect(capRows).toHaveLength(0);
    const { rows: dayStaffRows } = await pool.query(
      `SELECT position FROM roles WHERE name = 'Day Staff'`,
    );
    expect(rows[0].position).toBeLessThan(dayStaffRows[0].position);
  });

  it("orders Applications Lead above Applications Team and Judging Coordinator above Judging Team", async () => {
    const pool = await seededRoles();
    const { rows } = await pool.query(
      `SELECT name, position FROM roles
        WHERE name = ANY($1::text[])`,
      [["Applications Team", "Applications Lead", "Judging Team", "Judging Coordinator"]],
    );
    const positions = new Map<string, number>(
      rows.map((r: { name: string; position: number }) => [r.name, r.position]),
    );
    function positionOf(name: string): number {
      const position = positions.get(name);
      if (position == null) throw new Error(`role "${name}" should exist`);
      return position;
    }
    expect(positionOf("Applications Lead")).toBeGreaterThan(positionOf("Applications Team"));
    expect(positionOf("Judging Coordinator")).toBeGreaterThan(positionOf("Judging Team"));
  });
});

describe("H8 revoke-superadmin's last-active-superadmin guard", () => {
  it("refuses to leave zero active wildcard holders (the guard scripts/revoke-superadmin.mjs mirrors)", async () => {
    const { assertActiveWildcardHolder } = await import(
      "../../src/modules/identity/role-authority.js"
    );
    const { withTransaction } = await import("../../src/db/pool.js");
    const soleSuperadmin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);

    await withTransaction(async (client) => {
      await expect(assertActiveWildcardHolder(client, soleSuperadmin)).rejects.toThrow(
        "Role changes must retain one active wildcard holder",
      );
    });

    // With a second holder present, excluding the first no longer trips it.
    await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    await withTransaction(async (client) => {
      await expect(assertActiveWildcardHolder(client, soleSuperadmin)).resolves.toBeUndefined();
    });
  });
});
