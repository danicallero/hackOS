import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { admitParticipant } from "../projects/fixtures.js";

/**
 * #1083/H8: staff revoke and staff PDF read reach a certificate through the
 * viewed edition only; owner and public verification stay cross-edition.
 */

let app: App;
let staff: number;
let person: number;
let certId: number;
let certCode: string;

beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  await pool.query(
    `INSERT INTO event_config (id, name, venue_name, event_starts_at, event_ends_at)
     VALUES (1, 'HackUDC', 'Facultad de Informática', '2026-02-27T09:00:00Z', '2026-03-01T17:00:00Z')
     ON CONFLICT (id) DO UPDATE SET name = 'HackUDC', venue_name = 'Facultad de Informática',
       event_starts_at = '2026-02-27T09:00:00Z', event_ends_at = '2026-03-01T17:00:00Z'`,
  );
  await pool.query(
    `UPDATE certificate_settings SET min_hours = 1, min_review_hours = NULL, award_hours = NULL`,
  );
  await pool.query(
    `UPDATE certificate_types SET enabled=true, attendance_policy=true, self_service=true WHERE legacy_variant='participation'`,
  );
  await pool.query(`INSERT INTO editions (event_key, name, status) VALUES ('e2', 'E2', 'active')`);
  staff = await createUserWithCapabilities([CAPABILITIES.PRESENCE_MANAGE]);
  // The staff member also holds the same role in the second edition.
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id, event_key)
     SELECT user_id, role_id, 'e2' FROM user_roles WHERE user_id = $1`,
    [staff],
  );
  person = await createUser({ name: "Ada" });
  await pool.query(`UPDATE users SET surname = 'Lovelace', dni = '12345678Z' WHERE id = $1`, [
    person,
  ]);
  await admitParticipant(person);
  await pool.query(
    `INSERT INTO time_logs (user_id, kind, scanned_at) VALUES
       ($1, 'in', now() - interval '5 hours'), ($1, 'out', now() - interval '1 hour')`,
    [person],
  );
  const issued = await app.inject({
    method: "POST",
    url: "/api/me/certificates",
    headers: asUser(person),
    payload: { variant: "participation", locale: "es" },
  });
  expect(issued.statusCode).toBe(200);
  certId = issued.json().id;
  certCode = issued.json().code;
  // The certificate belongs to the second edition from here on.
  await pool.query(`UPDATE attendance_certificates SET event_key = 'e2' WHERE id = $1`, [certId]);
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

const revoke = (edition?: string) =>
  app.inject({
    method: "POST",
    url: `/api/certificates/${certId}/revoke`,
    headers: { ...asUser(staff), ...(edition ? { "x-edition": edition } : {}) },
    payload: { reason: "Mistake" },
  });
const staffPdf = (edition?: string) =>
  app.inject({
    method: "GET",
    url: `/api/certificates/${certId}/pdf`,
    headers: { ...asUser(staff), ...(edition ? { "x-edition": edition } : {}) },
  });

describe("staff certificate access per edition", () => {
  it("answers 404 to a staff revoke from another edition and revokes in its own", async () => {
    expect((await revoke()).statusCode).toBe(404);
    const untouched = await pool.query(
      `SELECT revoked_at FROM attendance_certificates WHERE id=$1`,
      [certId],
    );
    expect(untouched.rows[0].revoked_at).toBeNull();
    expect((await revoke("e2")).statusCode).toBe(200);
    const revoked = await pool.query(`SELECT revoked_at FROM attendance_certificates WHERE id=$1`, [
      certId,
    ]);
    expect(revoked.rows[0].revoked_at).not.toBeNull();
  });

  it("answers 404 to a staff PDF read from another edition and serves it in its own", async () => {
    expect((await staffPdf()).statusCode).toBe(404);
    const own = await staffPdf("e2");
    expect(own.statusCode).toBe(200);
    expect(own.headers["content-type"]).toBe("application/pdf");
  });

  it("keeps the owner download and the public verification cross-edition", async () => {
    const owner = await app.inject({
      method: "GET",
      url: `/api/me/certificates/${certId}/pdf`,
      headers: asUser(person),
    });
    expect(owner.statusCode).toBe(200);
    const check = await app.inject({ method: "GET", url: `/api/public/certificates/${certCode}` });
    expect(check.statusCode).toBe(200);
    expect(check.json().status).toBe("valid");
  });
});
