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
    const actor = await manager();
    const { pool } = await import("../../src/db/pool.js");
    // Give this manager a very high position so it can manage the roles it creates.
    await pool.query(
      `UPDATE roles SET position = 1000000 WHERE id = (SELECT role_id FROM user_roles WHERE user_id = $1)`,
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
      "delete",
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
