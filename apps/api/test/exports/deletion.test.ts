import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { processDataSubjectRequest } from "../../src/modules/exports/worker.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** H54 deletion requests: creation is ADMIN_ALL-gated and uses the same
 * server-side delete/anonymize boundary as the in-app account action. */

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

describe("deletion requests (H54)", () => {
  it("blocks a plain exports:run holder from filing a deletion request", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const subject = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: subject, type: "deletion" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets ADMIN_ALL file and process a deletion request, scrubbing PII and leaving an audit trail", async () => {
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({ name: "Real Person", email: "person@example.test" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET surname = 'Doe', dni = '00000000T' WHERE id = $1`, [target]);
    await pool.query(`UPDATE users SET badge_id = 'B-DSR-ANON' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-DSR-ANON', $2)`,
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

    const { rows } = await pool.query(
      `SELECT email, name, surname, dni, email_verified FROM users WHERE id = $1`,
      [target],
    );
    expect(rows).toHaveLength(0);
    expect((await pool.query(`SELECT 1 FROM anonymous_participants`)).rowCount).toBe(1);

    const status = await app.inject({
      method: "GET",
      url: `/api/exports/requests/${requestId}`,
      headers: asUser(admin),
    });
    expect(status.json().status).toBe("completed");

    const { rows: auditRows } = await pool.query(
      `SELECT entity_type, action FROM audit_log WHERE entity_type = 'anonymous_participant' ORDER BY id`,
    );
    expect(
      auditRows.some((r: { entity_type: string; action: string }) => r.action === "anonymized"),
    ).toBe(true);
    const { rows: requestAuditRows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'data_subject_request' AND entity_id = $1 ORDER BY id`,
      [String(requestId)],
    );
    // The original request audit payload contains subjectUserId and is
    // removed with the departing identity. Only the identity-free completion
    // marker survives.
    expect(requestAuditRows.map((r: { action: string }) => r.action)).toEqual([
      "deletion_completed",
    ]);
  });
});
