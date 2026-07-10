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

/** H54 deletion requests: creation is ADMIN_ALL-gated, processing reuses anonymizeUser. */

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
    await pool.query(
      `UPDATE users SET surname = 'Doe', phone = '555', dni = '00000000T' WHERE id = $1`,
      [target],
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
      `SELECT email, name, surname, phone, dni, email_verified FROM users WHERE id = $1`,
      [target],
    );
    expect(rows[0].email).toBe(`anonymized+${target}@deleted.invalid`);
    expect(rows[0].name).toBe("Anonymized");
    expect(rows[0].surname).toBeNull();
    expect(rows[0].phone).toBeNull();
    expect(rows[0].dni).toBeNull();
    expect(rows[0].email_verified).toBe(false);

    const status = await app.inject({
      method: "GET",
      url: `/api/exports/requests/${requestId}`,
      headers: asUser(admin),
    });
    expect(status.json().status).toBe("completed");

    const { rows: auditRows } = await pool.query(
      `SELECT entity_type, action FROM audit_log WHERE entity_id = $1 ORDER BY id`,
      [String(target)],
    );
    expect(
      auditRows.some((r: { entity_type: string; action: string }) => r.action === "anonymized"),
    ).toBe(true);
    const { rows: requestAuditRows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'data_subject_request' AND entity_id = $1 ORDER BY id`,
      [String(requestId)],
    );
    expect(requestAuditRows.map((r: { action: string }) => r.action)).toEqual([
      "requested",
      "deletion_completed",
    ]);
  });
});
