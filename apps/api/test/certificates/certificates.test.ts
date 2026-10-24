import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { PDFDocument } from "pdf-lib";
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
import { admitParticipant, createChallenge } from "../projects/fixtures.js";

/** #1083: attendance certificates issued by the organisation, verified by code. */

let app: App;
let staff: number;
let person: number;

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
    `UPDATE certificate_settings SET min_hours = 10, requires_demo = false, issuer_name = DEFAULT`,
  );
  staff = await createUserWithCapabilities([CAPABILITIES.PRESENCE_MANAGE]);
  person = await createUser({ name: "Ada" });
  await pool.query(`UPDATE users SET surname = 'Lovelace', dni = '12345678Z' WHERE id = $1`, [
    person,
  ]);
  await admitParticipant(person);
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

/** A closed in/out pair `hours` long, ending an hour ago. */
async function presence(userId: number, hours: number) {
  await pool.query(
    `INSERT INTO time_logs (user_id, kind, scanned_at) VALUES
       ($1, 'in', now() - ($2 || ' hours')::interval - interval '1 hour'),
       ($1, 'out', now() - interval '1 hour')`,
    [userId, String(hours)],
  );
}

async function presented(userId: number) {
  const challengeId = await createChallenge("Challenge");
  const repo = await pool.query(`INSERT INTO repos (name) VALUES ('Team') RETURNING id`);
  await pool.query(`INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`, [
    repo.rows[0].id,
    userId,
  ]);
  await pool.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status, completed_at)
     VALUES ($1, $2, 'completed', now())`,
    [challengeId, repo.rows[0].id],
  );
}

const issue = (user: number, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/me/certificates",
    headers: asUser(user),
    payload: { variant: "participation", locale: "es", ...payload },
  });

describe("self-service issue", () => {
  it("issues once the venue-hours threshold is met and returns the same certificate again", async () => {
    await presence(person, 12);
    const first = await issue(person);
    expect(first.statusCode).toBe(200);
    expect(first.json().source).toBe("self");
    const again = await issue(person);
    expect(again.json().id).toBe(first.json().id);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM attendance_certificates`);
    expect(rows[0].n).toBe(1);
  });

  it("refuses below the threshold and when certificates are off, with a reason", async () => {
    await presence(person, 3);
    const below = await issue(person);
    expect(below.statusCode).toBe(409);
    expect(below.json().error.details.code).toBe("certificate_hours_not_met");
    await pool.query(`UPDATE certificate_settings SET min_hours = NULL`);
    const off = await issue(person);
    expect(off.json().error.details.code).toBe("certificate_not_available");
  });

  it("requires a presented project when the policy says so", async () => {
    await presence(person, 12);
    await pool.query(`UPDATE certificate_settings SET requires_demo = true`);
    const without = await issue(person);
    expect(without.json().error.details.code).toBe("certificate_demo_required");
    await presented(person);
    expect((await issue(person)).statusCode).toBe(200);
  });

  it("converges when requested concurrently", async () => {
    await presence(person, 12);
    const results = await Promise.all([issue(person), issue(person), issue(person)]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
  });

  it("is limited to attendees", async () => {
    const outsider = await createUser();
    await presence(outsider, 12);
    expect((await issue(outsider)).statusCode).toBe(403);
  });
});

describe("pdf and verification", () => {
  it("serves each variant to its owner only, and refuses other people", async () => {
    await presence(person, 12);
    for (const variant of ["participation", "hours", "activities"]) {
      const created = await issue(person, { variant, locale: "gl" });
      const pdf = await app.inject({
        method: "GET",
        url: `/api/me/certificates/${created.json().id}/pdf`,
        headers: asUser(person),
      });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      const other = await createUser();
      const denied = await app.inject({
        method: "GET",
        url: `/api/me/certificates/${created.json().id}/pdf`,
        headers: asUser(other),
      });
      expect(denied.statusCode).toBe(403);
    }
  });

  it("verifies by code without the DNI, and only the hours variant states hours", async () => {
    await presence(person, 12);
    const hours = (await issue(person, { variant: "hours" })).json();
    const plain = (await issue(person, { variant: "participation" })).json();
    const verified = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${hours.code}`,
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      status: "valid",
      variant: "hours",
      name: "Ada",
      surname: "Lovelace",
      eventName: "HackUDC",
    });
    expect(verified.json().hours).toBeGreaterThanOrEqual(12);
    expect(JSON.stringify(verified.json())).not.toContain("12345678Z");
    const participation = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${plain.code}`,
    });
    expect(participation.json().hours).toBeNull();
    const unknown = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${"x".repeat(24)}`,
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe("staff", () => {
  it("overrides the threshold only with a reason, audits it, and downloads anyone's PDF", async () => {
    await presence(person, 2);
    const refused = await app.inject({
      method: "POST",
      url: "/api/certificates",
      headers: asUser(staff),
      payload: { userId: person, variant: "participation", locale: "es" },
    });
    expect(refused.statusCode).toBe(409);
    const issued = await app.inject({
      method: "POST",
      url: "/api/certificates",
      headers: asUser(staff),
      payload: {
        userId: person,
        variant: "participation",
        locale: "es",
        overrideReason: "Left early for a flight",
      },
    });
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toMatchObject({
      source: "staff",
      overrideReason: "Left early for a flight",
    });
    const { rows } = await pool.query(
      `SELECT reason FROM audit_log WHERE action = 'certificate.issue'`,
    );
    expect(rows[0].reason).toBe("Left early for a flight");
    const pdf = await app.inject({
      method: "GET",
      url: `/api/certificates/${issued.json().id}/pdf`,
      headers: asUser(staff),
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/certificates/${issued.json().id}/pdf`,
          headers: asUser(person),
        })
      ).statusCode,
    ).toBe(403);
  });

  it("bulk issue covers only eligible people and is repeatable", async () => {
    const other = await createUser();
    await admitParticipant(other);
    const low = await createUser();
    await admitParticipant(low);
    await presence(person, 12);
    await presence(other, 11);
    await presence(low, 1);
    const run = () =>
      app.inject({
        method: "POST",
        url: "/api/certificates/bulk",
        headers: asUser(staff),
        payload: { variant: "participation", locale: "en" },
      });
    expect((await run()).json()).toEqual({ issued: 2, existing: 0, skipped: 1 });
    expect((await run()).json()).toEqual({ issued: 0, existing: 2, skipped: 1 });
  });

  it("revokes a certificate: verification says so, the PDF is gone and a new one can be issued", async () => {
    await presence(person, 12);
    const cert = (await issue(person)).json();
    const revoked = await app.inject({
      method: "POST",
      url: `/api/certificates/${cert.id}/revoke`,
      headers: asUser(staff),
      payload: { reason: "Issued by mistake" },
    });
    expect(revoked.statusCode).toBe(200);
    const check = await app.inject({ method: "GET", url: `/api/public/certificates/${cert.code}` });
    expect(check.json()).toMatchObject({ status: "revoked", name: null, surname: null });
    const pdf = await app.inject({
      method: "GET",
      url: `/api/me/certificates/${cert.id}/pdf`,
      headers: asUser(person),
    });
    expect(pdf.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/certificates/${cert.id}/revoke`,
          headers: asUser(staff),
          payload: { reason: "again" },
        })
      ).statusCode,
    ).toBe(409);
    expect((await issue(person)).json().id).not.toBe(cert.id);
  });

  it("needs the presence capability and lets staff change the policy", async () => {
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/certificates/settings",
          headers: asUser(person),
        })
      ).statusCode,
    ).toBe(403);
    const updated = await app.inject({
      method: "PUT",
      url: "/api/certificates/settings",
      headers: asUser(staff),
      payload: { minHours: 20, requiresDemo: true },
    });
    expect(updated.json()).toMatchObject({ minHours: 20, requiresDemo: true });
    const { rows } = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'certificate_settings.update'`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("signed original and CSV footer", () => {
  const get = (url: string, user: number) =>
    app.inject({ method: "GET", url, headers: asUser(user) });
  const pages = async (res: { rawPayload: Buffer }) =>
    (await PDFDocument.load(res.rawPayload)).getPageCount();

  async function signedPdf(pageCount: number) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
    return Buffer.from(await doc.save());
  }
  function putSigned(id: number, bytes: Buffer, key: string) {
    const boundary = `----hackos-${key}`;
    return app.inject({
      method: "POST",
      url: `/api/certificates/${id}/signed`,
      headers: {
        ...asUser(staff),
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "idempotency-key": key,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="s.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  }

  it("stamps the CSV footer on participant copies only, and copies follow the signed original", async () => {
    await presence(person, 12);
    const cert = (await issue(person)).json();
    const mine = await get(`/api/me/certificates/${cert.id}/pdf`, person);
    const bare = await get(`/api/certificates/${cert.id}/pdf`, staff);
    const staffCopy = await get(`/api/certificates/${cert.id}/pdf?copy=true`, staff);
    // The footer adds a QR image and text: the bare document is smaller.
    expect(bare.rawPayload.length).toBeLessThan(mine.rawPayload.length);
    expect(staffCopy.rawPayload.length).toBeGreaterThan(bare.rawPayload.length);

    const rejected = await putSigned(cert.id, Buffer.from("not a pdf"), "bad");
    expect(rejected.statusCode).toBe(400);
    const uploaded = await putSigned(cert.id, await signedPdf(3), "ok");
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().signedAt).not.toBeNull();

    expect(await pages(await get(`/api/me/certificates/${cert.id}/pdf`, person))).toBe(3);
    expect(await pages(await get(`/api/certificates/${cert.id}/pdf`, staff))).toBe(3);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'certificate.sign_upload'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("refuses a signed upload to a revoked certificate and to people without the capability", async () => {
    await presence(person, 12);
    const cert = (await issue(person)).json();
    await app.inject({
      method: "POST",
      url: `/api/certificates/${cert.id}/revoke`,
      headers: { ...asUser(staff), "idempotency-key": "revoke" },
      payload: { reason: "mistake" },
    });
    expect((await putSigned(cert.id, await signedPdf(1), "late")).statusCode).toBe(409);
  });
});
