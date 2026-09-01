import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { processDataSubjectRequest } from "../../src/modules/exports/worker.js";
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
 * H8/H53/H54: anonymization must collapse the departing identity's own role
 * assignments to visible-only. The repo owner's explicit direction: keep the
 * coarse fact "was Staff" for reporting, never a hidden operational role's
 * name (e.g. a "Door Operator" role). The users row (and therefore every
 * user_roles row, via ON DELETE CASCADE) is fully removed by anonymization —
 * see apps/api/test/exports/deletion.test.ts — so the only place this
 * distinction can outlive the transaction is the permanent
 * anonymous_participants audit trail.
 */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
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

describe("anonymization strips non-visible role assignments (H8, H53, H54)", () => {
  it("keeps only the visible role's name in the permanent audit trail and drops every user_roles row", async () => {
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({ name: "Real Person", email: "person@example.test" });
    const { pool } = await import("../../src/db/pool.js");

    const visibleRole = await createRole([], { name: "Staff", isVisible: true });
    const hiddenRole = await createRole([], { name: "Door Operator", isVisible: false });
    await assignRole(target, visibleRole);
    await assignRole(target, hiddenRole);

    // Force eligibility to "anonymize" (operational history via check_in_logs).
    await pool.query(`UPDATE users SET badge_id = 'B-ANON-ROLES' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-ANON-ROLES', $2)`,
      [target, admin],
    );

    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(admin),
      payload: { subjectUserId: target, type: "deletion" },
    });
    expect(created.statusCode).toBe(201);
    const requestId = created.json().id;

    await processDataSubjectRequest(requestId);

    // The users row (and every user_roles row referencing it, cascading) is
    // fully gone regardless of role visibility — confirming no special-casing
    // is needed for getEffectiveRole/getBadgeCategory post-anonymization.
    const { rows: userRows } = await pool.query(`SELECT id FROM users WHERE id = $1`, [target]);
    expect(userRows).toHaveLength(0);
    const { rows: roleRows } = await pool.query(`SELECT 1 FROM user_roles WHERE user_id = $1`, [
      target,
    ]);
    expect(roleRows).toHaveLength(0);

    const { rows: auditRows } = await pool.query<{ after: { retainedRoles?: string[] } }>(
      `SELECT after FROM audit_log
        WHERE entity_type = 'anonymous_participant' AND action = 'anonymized'
        ORDER BY id DESC LIMIT 1`,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.after?.retainedRoles).toEqual(["Staff"]);
    expect(auditRows[0]?.after?.retainedRoles).not.toContain("Door Operator");
  });

  it("retains every visible role name when a user holds more than one", async () => {
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({ name: "Multi Role", email: "multi@example.test" });
    const { pool } = await import("../../src/db/pool.js");

    const staffRole = await createRole([], { name: "Staff", isVisible: true });
    const mentorRole = await createRole([], { name: "Mentor", isVisible: true });
    await assignRole(target, staffRole);
    await assignRole(target, mentorRole);

    await pool.query(`UPDATE users SET badge_id = 'B-ANON-MULTI' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-ANON-MULTI', $2)`,
      [target, admin],
    );

    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(admin),
      payload: { subjectUserId: target, type: "deletion" },
    });
    const requestId = created.json().id;
    await processDataSubjectRequest(requestId);

    const { rows: auditRows } = await pool.query<{ after: { retainedRoles?: string[] } }>(
      `SELECT after FROM audit_log
        WHERE entity_type = 'anonymous_participant' AND action = 'anonymized'
        ORDER BY id DESC LIMIT 1`,
    );
    expect(new Set(auditRows[0]?.after?.retainedRoles)).toEqual(new Set(["Staff", "Mentor"]));
  });

  it("retains no role names when the user only ever held hidden roles", async () => {
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({ name: "Hidden Only", email: "hidden@example.test" });
    const { pool } = await import("../../src/db/pool.js");

    const hiddenRole = await createRole([], { name: "Door Operator", isVisible: false });
    await assignRole(target, hiddenRole);

    await pool.query(`UPDATE users SET badge_id = 'B-ANON-HIDDEN' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-ANON-HIDDEN', $2)`,
      [target, admin],
    );

    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(admin),
      payload: { subjectUserId: target, type: "deletion" },
    });
    const requestId = created.json().id;
    await processDataSubjectRequest(requestId);

    const { rows: auditRows } = await pool.query<{ after: { retainedRoles?: string[] } }>(
      `SELECT after FROM audit_log
        WHERE entity_type = 'anonymous_participant' AND action = 'anonymized'
        ORDER BY id DESC LIMIT 1`,
    );
    expect(auditRows[0]?.after?.retainedRoles).toEqual([]);
  });
});
