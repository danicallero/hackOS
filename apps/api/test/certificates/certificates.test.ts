import "./env.js";
import { createHash } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  assignRole,
  asUser,
  buildTestApp,
  createRole,
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
    `UPDATE certificate_settings SET min_hours = 10, min_review_hours = NULL, award_hours = NULL, issuer_name = DEFAULT`,
  );
  await pool.query(`DELETE FROM certificate_types WHERE legacy_variant IS NULL`);
  await pool.query(
    `UPDATE certificate_types SET enabled=true, attendance_policy=true, self_service=true, audience_role_ids=NULL, allow_guests=false, identity_policy='optional', requires_activity=false, demo_requirement='none', demo_challenge_id=NULL, exempt_role_ids=NULL, body_i18n=NULL WHERE legacy_variant IN ('participation','hours','activities')`,
  );
  await pool.query(
    `UPDATE certificate_types SET enabled=true WHERE legacy_variant='accepted_spot'`,
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

/** One scanned, non-meal activity: what the Activities certificate lists. */
async function scanned(userId: number, name = "Intro to Rust") {
  const activity = await pool.query(
    `INSERT INTO activities (name, category) VALUES ($1, 'workshop') RETURNING id`,
    [name],
  );
  await pool.query(`INSERT INTO activity_logs (user_id, activity_id) VALUES ($1, $2)`, [
    userId,
    activity.rows[0].id,
  ]);
}

/** The words drawn on the PDF's pages (standard fonts store them as hex strings). */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let text = "";
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const content = Buffer.from(decodePDFRawStream(object).decode()).toString("latin1");
    for (const match of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
      text += `${Buffer.from(match[1] as string, "hex").toString("latin1")} `;
  }
  return text;
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

  it("requires a presented project when the type says so", async () => {
    await presence(person, 12);
    await pool.query(
      `UPDATE certificate_types SET demo_requirement='any' WHERE legacy_variant='participation'`,
    );
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

  it("does not issue from provisional hours, individually or in bulk", async () => {
    await pool.query(`UPDATE certificate_settings SET min_hours = 1`);
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '2 hours')`,
      [person],
    );
    const overview = await app.inject({
      method: "GET",
      url: "/api/me/certificates",
      headers: asUser(person),
    });
    expect(overview.json().eligibility).toMatchObject({ hours: 0, eligible: false });
    expect((await issue(person)).statusCode).toBe(409);
    const bulk = await app.inject({
      method: "POST",
      url: "/api/certificates/bulk",
      headers: asUser(staff),
      payload: { variant: "hours", locale: "en" },
    });
    expect(bulk.json()).toEqual({ issued: 0, existing: 0, skipped: 1 });
    await pool.query(`INSERT INTO time_logs (user_id, kind) VALUES ($1, 'out')`, [person]);
    const secured = await issue(person, { variant: "hours" });
    expect(secured.statusCode).toBe(200);
    const verified = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${secured.json().code}`,
    });
    expect(verified.json().hours).toBeGreaterThanOrEqual(2);
  });

  it("keeps independent live documents in each language and converges per language", async () => {
    await presence(person, 12);
    const results = await Promise.all(
      ["es", "en", "gl", "en"].map((locale) => issue(person, { locale })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.map((r) => r.json().locale)).toEqual(["es", "en", "gl", "en"]);
    expect(new Set(results.map((r) => r.json().code)).size).toBe(3);
    expect(results[1]!.json().id).toBe(results[3]!.json().id);
    const bulk = await app.inject({
      method: "POST",
      url: "/api/certificates/bulk",
      headers: asUser(staff),
      payload: { variant: "participation", locale: "gl" },
    });
    expect(bulk.json()).toEqual({ issued: 0, existing: 1, skipped: 0 });
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
    await scanned(person);
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
        certifiedHours: 30,
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

  it("serializes concurrent policy patches without losing either edit", async () => {
    const { updateSettings, readSettings } = await import(
      "../../src/modules/certificates/service.js"
    );
    const blocker = await pool.connect();
    let pending: Promise<unknown>[] = [];
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM certificate_settings WHERE id = 1 FOR UPDATE");
      pending = [
        updateSettings(staff, { minHours: 20 }),
        updateSettings(staff, { issuerName: "Organisers" }),
      ];
      const deadline = Date.now() + 5000;
      let waiting = 0;
      while (waiting < 2 && Date.now() < deadline) {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
             AND query LIKE '%certificate_settings%'`,
        );
        waiting = rows[0].n;
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(2);
      await blocker.query("COMMIT");
      await Promise.all(pending);
      expect(await readSettings()).toMatchObject({ minHours: 20, issuerName: "Organisers" });
      const { rows } = await pool.query(
        `SELECT before, after FROM audit_log WHERE action = 'certificate_settings.update' ORDER BY id`,
      );
      expect(rows).toHaveLength(2);
      expect(rows[1].before).toEqual(rows[0].after);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(pending);
    }
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
      payload: { minHours: 20, issuerName: "Organisers" },
    });
    expect(updated.json()).toMatchObject({ minHours: 20, issuerName: "Organisers" });
    const { rows } = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'certificate_settings.update'`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("attendance review and university awards (#1083)", () => {
  const approve = (userId: number, certifiedHours = 30) =>
    app.inject({
      method: "POST",
      url: `/api/users/${userId}/certificate-approval`,
      headers: asUser(staff),
      payload: {
        certifiedHours,
        reason: "Dinner and midnight workshop confirm participation despite missing breakfast",
      },
    });

  it("opens review at the lower threshold and requires an explicit hours award", async () => {
    await presence(person, 12);
    await pool.query(`UPDATE certificate_settings SET min_hours=30, min_review_hours=10`);
    const waiting = await issue(person, { variant: "hours" });
    expect(waiting.statusCode).toBe(409);
    expect(waiting.json().error.details.code).toBe("certificate_review_required");
    const missingHours = await app.inject({
      method: "POST",
      url: `/api/users/${person}/certificate-approval`,
      headers: asUser(staff),
      payload: { reason: "Review" },
    });
    expect(missingHours.statusCode).toBe(400);
    const decision = await approve(person);
    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toMatchObject({
      hours: 12,
      certifiedHours: 30,
      eligible: true,
      reviewRequired: false,
    });
    const cert = (await issue(person, { variant: "hours" })).json();
    const verified = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${cert.code}`,
    });
    expect(verified.json().hours).toBe(30);
    const { rows } = await pool.query(`SELECT snapshot FROM attendance_certificates WHERE id=$1`, [
      cert.id,
    ]);
    expect(rows[0].snapshot.hours).toBe(30);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM time_logs WHERE user_id=$1`, [person]))
        .rows[0].n,
    ).toBe(2);
    expect(
      (await pool.query(`SELECT after FROM audit_log WHERE action='certificate.approve'`)).rows[0]
        .after.certifiedHours,
    ).toBe(30);
  });

  it("keeps automatic eligibility above its threshold and queues only the review band", async () => {
    await pool.query(`UPDATE certificate_settings SET min_hours=10, min_review_hours=5`);
    await presence(person, 11);
    expect((await issue(person)).statusCode).toBe(200);
    const low = await createUser();
    await admitParticipant(low);
    await presence(low, 3);
    const lowResult = await issue(low);
    expect(lowResult.json().error.details.code).toBe("certificate_hours_not_met");
    const roster = await app.inject({
      method: "GET",
      url: "/api/certificates/participants",
      headers: asUser(staff),
    });
    expect(roster.statusCode).toBe(200);
    expect(
      roster.json().items.find((p: { userId: number }) => p.userId === person).eligibility,
    ).toMatchObject({ certifiedHours: 11, eligible: true });
    expect(
      roster.json().items.find((p: { userId: number }) => p.userId === low).eligibility
        .reviewRequired,
    ).toBe(false);
  });

  it("revokes documents with obsolete hours when an award changes", async () => {
    await presence(person, 12);
    const previous = (await issue(person, { variant: "hours" })).json();
    await approve(person, 30);
    const oldCode = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${previous.code}`,
    });
    expect(oldCode.json().status).toBe("revoked");
    const next = (await issue(person, { variant: "hours" })).json();
    expect(next.id).not.toBe(previous.id);
    await approve(person, 30);
    expect((await issue(person, { variant: "hours" })).json().id).toBe(next.id);
  });

  it("exports measured versus certified time and matches UDC columns, scoped by university", async () => {
    await presence(person, 12);
    await approve(person);
    const other = await createUser({ name: "Other university" });
    await admitParticipant(other);
    await presence(other, 15);
    const uni = await pool.query(
      `INSERT INTO universities(name) VALUES ('Universidade da Coruña') RETURNING id`,
    );
    await pool.query(`UPDATE users SET university_id=$2 WHERE id=$1`, [person, uni.rows[0].id]);
    const exporter = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const url = `/api/certificates/participants/export.csv?universityId=${uni.rows[0].id}`;
    const general = await app.inject({ method: "GET", url, headers: asUser(exporter) });
    expect(general.statusCode).toBe(200);
    expect(general.body).toContain("measured_hours,certified_hours,status");
    expect(general.body).toContain(",12,30,approved");
    expect(general.body).not.toContain("Other university");
    const udc = await app.inject({
      method: "GET",
      url: `${url}&format=udc`,
      headers: asUser(exporter),
    });
    expect(udc.statusCode).toBe(200);
    expect(udc.body).toContain(
      "Nome Asociación,Nome e apelidos,DNI,Nome da actividade,Data da actividade,Lugar de realización,Nº de horas realizadas,Observacións",
    );
    expect(udc.body).toContain("Ada Lovelace,12345678Z,HackUDC");
    expect(udc.body).toContain(",30,");
    expect(udc.body).not.toContain("Other university");
    expect(udc.headers["cache-control"]).toContain("no-store");
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM audit_log WHERE entity_type='certificate_export'`,
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it("never exports an unapproved review candidate as a UDC award", async () => {
    await presence(person, 12);
    await pool.query(`UPDATE certificate_settings SET min_hours=30, min_review_hours=10`);
    const exporter = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const udc = await app.inject({
      method: "GET",
      url: "/api/certificates/participants/export.csv?format=udc",
      headers: asUser(exporter),
    });
    expect(udc.body).not.toContain("Ada");
    expect((await approve(person, 0)).statusCode).toBe(400);
    const unauthorized = await app.inject({
      method: "POST",
      url: `/api/users/${person}/certificate-approval`,
      headers: asUser(person),
      payload: { certifiedHours: 30, reason: "Self" },
    });
    expect(unauthorized.statusCode).toBe(403);
  });

  it("shows meals and late-night activity evidence to reviewers", async () => {
    const { createActivity, createMeal } = await import("../logistics/fixtures.js");
    const dinner = await createMeal("Dinner");
    const workshop = await createActivity({ name: "Midnight workshop", requiresScan: true });
    await pool.query(
      `INSERT INTO activity_logs(user_id,activity_id,logged_at) VALUES
      ($1,$2,'2026-02-28T20:00:00Z'),($1,$3,'2026-02-28T23:00:00Z')`,
      [person, dinner, workshop],
    );
    const evidence = await app.inject({
      method: "GET",
      url: `/api/users/${person}/certificate-evidence`,
      headers: asUser(staff),
    });
    expect(evidence.statusCode).toBe(200);
    expect(
      evidence.json().signals.map((signal: { activityName: string }) => signal.activityName),
    ).toEqual(["Dinner", "Midnight workshop"]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/users/${person}/certificate-evidence`,
          headers: asUser(person),
        })
      ).statusCode,
    ).toBe(403);
  });

  it("serializes changing awards with concurrent certificate issuance", async () => {
    await presence(person, 12);
    await approve(person, 25);
    const results = await Promise.all([
      approve(person, 30),
      issue(person, { variant: "hours" }),
      approve(person, 35),
      issue(person, { variant: "participation" }),
    ]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    await issue(person, { variant: "hours" });
    const { rows } = await pool.query(
      `SELECT (c.snapshot->>'hours')::numeric = a.certified_hours AS matches
      FROM attendance_certificates c JOIN certificate_approvals a ON a.user_id=c.user_id WHERE c.user_id=$1 AND c.revoked_at IS NULL`,
      [person],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.matches)).toBe(true);
  });

  it("uses editable policy hours and lets an individual review override them", async () => {
    await presence(person, 12);
    const initial = await app.inject({
      method: "GET",
      url: "/api/certificates/settings",
      headers: asUser(staff),
    });
    expect(initial.json().awardHours).toBeNull();
    const policy = await app.inject({
      method: "PUT",
      url: "/api/certificates/settings",
      headers: asUser(staff),
      payload: { awardHours: 37.5 },
    });
    expect(policy.json().awardHours).toBe(37.5);
    const cert = (await issue(person, { variant: "hours" })).json();
    expect(
      (await app.inject({ method: "GET", url: `/api/public/certificates/${cert.code}` })).json()
        .hours,
    ).toBe(37.5);
    const overview = await app.inject({
      method: "GET",
      url: `/api/users/${person}/certificates`,
      headers: asUser(staff),
    });
    expect(overview.json().settings.awardHours).toBe(37.5);
    await approve(person, 22.5);
    const reviewed = (await issue(person, { variant: "hours" })).json();
    expect(
      (await app.inject({ method: "GET", url: `/api/public/certificates/${reviewed.code}` })).json()
        .hours,
    ).toBe(22.5);
    const exporter = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const csv = await app.inject({
      method: "GET",
      url: "/api/certificates/participants/export.csv?format=udc",
      headers: asUser(exporter),
    });
    expect(csv.body).toContain(",22.5,");
  });

  it("invalidates old automatic policy awards but preserves individual decisions", async () => {
    await presence(person, 12);
    const auto = (await issue(person, { variant: "hours" })).json();
    const other = await createUser();
    await admitParticipant(other);
    await presence(other, 11);
    await approve(other, 19);
    const manual = (await issue(other, { variant: "hours" })).json();
    const change = await app.inject({
      method: "PUT",
      url: "/api/certificates/settings",
      headers: asUser(staff),
      payload: { awardHours: 41 },
    });
    expect(change.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: `/api/public/certificates/${auto.code}` })).json()
        .status,
    ).toBe("revoked");
    expect(
      (await app.inject({ method: "GET", url: `/api/public/certificates/${manual.code}` })).json(),
    ).toMatchObject({ status: "valid", hours: 19 });
    await app.inject({
      method: "PUT",
      url: "/api/certificates/settings",
      headers: asUser(staff),
      payload: { awardHours: null },
    });
    const reset = (await issue(person, { variant: "hours" })).json();
    expect(
      (await app.inject({ method: "GET", url: `/api/public/certificates/${reset.code}` })).json()
        .hours,
    ).toBe(12);
  });

  it("validates the two thresholds together", async () => {
    const result = await app.inject({
      method: "PUT",
      url: "/api/certificates/settings",
      headers: asUser(staff),
      payload: { minHours: 10, minReviewHours: 20 },
    });
    expect(result.statusCode).toBe(400);
    expect(
      (await pool.query(`SELECT min_review_hours FROM certificate_settings`)).rows[0]
        .min_review_hours,
    ).toBeNull();
  });
});

describe("official document by code", () => {
  it("serves the PDF with the footer to anyone with the code, until it is revoked", async () => {
    await presence(person, 12);
    const cert = (await issue(person)).json();
    const open = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${cert.code}/pdf`,
    });
    expect(open.statusCode).toBe(200);
    expect(open.headers["content-disposition"]).toContain("inline");
    expect(open.headers["x-robots-tag"]).toContain("noindex");
    expect(open.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const unknown = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${"x".repeat(24)}/pdf`,
    });
    expect(unknown.statusCode).toBe(404);
    await app.inject({
      method: "POST",
      url: `/api/certificates/${cert.id}/revoke`,
      headers: { ...asUser(staff), "idempotency-key": "official-revoke" },
      payload: { reason: "mistake" },
    });
    const revoked = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${cert.code}/pdf`,
    });
    expect(revoked.statusCode).toBe(409);
  });
});

describe("per-type requirements", () => {
  const get = (url: string, user: number) =>
    app.inject({ method: "GET", url, headers: asUser(user) });
  const code = async (variant: string, payload: Record<string, unknown> = {}) =>
    (await issue(person, { variant, ...payload })).json().error?.details?.code;
  const presentedTo = async (userId: number, challengeId: number) => {
    const repo = await pool.query(
      `INSERT INTO repos (name) VALUES ('Team ' || $1::text) RETURNING id`,
      [String(challengeId)],
    );
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`,
      [repo.rows[0].id, userId],
    );
    await pool.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, completed_at)
       VALUES ($1, $2, 'completed', now())`,
      [challengeId, repo.rows[0].id],
    );
  };

  it("waits for the event to end for Attendance, while Attendance hours is available any time", async () => {
    await presence(person, 12);
    await pool.query(`UPDATE event_config SET event_ends_at = now() + interval '2 days'`);
    expect(await code("participation")).toBe("certificate_event_not_ended");
    expect((await issue(person, { variant: "hours" })).statusCode).toBe(200);
    const overview = (await get("/api/me/certificates", person)).json();
    const byName = (name: string) =>
      overview.types.find((t: { name: { en: string } }) => t.name.en === name);
    expect(byName("Attendance").availability).toBe("event_not_ended");
    expect(byName("Attendance hours").availability).toBeNull();
    await pool.query(`UPDATE event_config SET event_ends_at = now() - interval '1 hour'`);
    expect((await issue(person)).statusCode).toBe(200);
  });

  it("requires presenting to the mandatory jury or to a chosen challenge", async () => {
    await presence(person, 12);
    const mandatory = await createChallenge("Mandatory");
    const other = await createChallenge("Other");
    await pool.query(`UPDATE challenges SET mandatory = true WHERE id = $1`, [mandatory]);
    await pool.query(
      `UPDATE certificate_types SET demo_requirement='mandatory' WHERE legacy_variant='participation'`,
    );
    await presentedTo(person, other);
    expect(await code("participation")).toBe("certificate_demo_jury_required");
    await pool.query(
      `UPDATE certificate_types SET demo_requirement='challenge', demo_challenge_id=$1 WHERE legacy_variant='participation'`,
      [other],
    );
    expect((await issue(person)).statusCode).toBe(200);
    await pool.query(`UPDATE challenges SET mandatory = false WHERE id = $1`, [mandatory]);
    await pool.query(
      `UPDATE certificate_types SET demo_requirement='mandatory' WHERE legacy_variant='hours'`,
    );
    expect(await code("hours")).toBe("certificate_demo_jury_required");
    await presentedTo(person, mandatory);
    await pool.query(`UPDATE challenges SET mandatory = true WHERE id = $1`, [mandatory]);
    expect((await issue(person, { variant: "hours" })).statusCode).toBe(200);
  });

  it("lets exempt roles skip hours, event end and presentation, and staff skip them with a reason", async () => {
    await pool.query(`UPDATE event_config SET event_ends_at = now() + interval '2 days'`);
    const organiser = await createUser({ name: "Org" });
    await admitParticipant(organiser);
    const role = await createRole([], { eventAccess: true });
    await assignRole(organiser, role);
    await pool.query(
      `UPDATE certificate_types SET demo_requirement='any', exempt_role_ids=$1 WHERE legacy_variant IN ('participation','hours')`,
      [[role]],
    );
    expect((await issue(person)).statusCode).toBe(409);
    expect((await issue(organiser)).statusCode).toBe(200);
    // Hours stated need a number: none measured, none awarded.
    expect((await issue(organiser, { variant: "hours" })).json().error.details.code).toBe(
      "certificate_hours_not_met",
    );
    await pool.query(`UPDATE certificate_settings SET award_hours = 8`);
    const hours = await issue(organiser, { variant: "hours" });
    expect(hours.statusCode).toBe(200);
    const verified = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${hours.json().code}`,
    });
    expect(verified.json().hours).toBe(8);
    const type = (
      await pool.query(`SELECT id FROM certificate_types WHERE legacy_variant='participation'`)
    ).rows[0].id;
    const staffIssue = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/api/certificates/issue",
        headers: asUser(staff),
        payload: { typeId: type, locale: "en", userId: person, ...payload },
      });
    expect((await staffIssue({})).statusCode).toBe(409);
    expect(
      (await staffIssue({ overrideReason: "Event organiser", certifiedHours: 5 })).statusCode,
    ).toBe(200);
  });

  it("validates the requirement fields and keeps Accepted spot unrestricted", async () => {
    const list = (await get("/api/certificates/types", staff)).json();
    const definition = (legacy: string) => {
      const { id, revision, legacyVariant, ...rest } = list.items.find(
        (t: { legacyVariant: string }) => t.legacyVariant === legacy,
      );
      return { id, revision, definition: rest };
    };
    const put = (legacy: string, patch: Record<string, unknown>) => {
      const { id, revision, definition: body } = definition(legacy);
      return app.inject({
        method: "PUT",
        url: `/api/certificates/types/${id}`,
        headers: asUser(staff),
        payload: { revision, definition: { ...body, ...patch } },
      });
    };
    expect((await put("hours", { demoRequirement: "challenge" })).statusCode).toBe(400);
    expect((await put("hours", { demoRequirement: "any", demoChallengeId: 1 })).statusCode).toBe(
      400,
    );
    expect((await put("accepted_spot", { requiresEventEnd: true })).statusCode).toBe(400);
    expect((await put("hours", { requiresEventEnd: true })).statusCode).toBe(200);
    expect(list.challenges).toEqual(expect.any(Array));
  });
});

describe("accepted spot follows event access", () => {
  const acceptedType = async () =>
    (await pool.query(`SELECT id FROM certificate_types WHERE legacy_variant='accepted_spot'`))
      .rows[0].id as number;
  const request = async (userId: number) =>
    (
      await app.inject({
        method: "POST",
        url: "/api/me/certificates/issue",
        headers: asUser(userId),
        payload: { typeId: await acceptedType(), locale: "en" },
      })
    ).json();
  const status = async (code: string) =>
    (await app.inject({ method: "GET", url: `/api/public/certificates/${code}` })).json().status;

  it("revokes it when the last event-access role goes, even after a copy was generated", async () => {
    const cert = await request(person);
    await app.inject({
      method: "GET",
      url: `/api/me/certificates/${cert.id}/pdf`,
      headers: asUser(person),
    });
    expect(await status(cert.code)).toBe("valid");
    await pool.query(`DELETE FROM user_roles WHERE user_id=$1`, [person]);
    const { rows } = await pool.query(
      `SELECT revoked_reason, pdf FROM attendance_certificates WHERE id=$1`,
      [cert.id],
    );
    expect(rows[0]).toEqual({ revoked_reason: "event_access_lost", pdf: null });
    expect(await status(cert.code)).toBe("revoked");
    const audit = await pool.query(
      `SELECT source FROM audit_log WHERE action='certificate.revoke' AND entity_id=$1`,
      [String(cert.id)],
    );
    expect(audit.rows).toEqual([{ source: "system" }]);
  });

  it("keeps it through a role swap, and revokes when the role stops granting access or is deleted", async () => {
    const cert = await request(person);
    const other = await createRole([], { eventAccess: true });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM user_roles WHERE user_id=$1`, [person]);
      await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
        person,
        other,
      ]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(await status(cert.code)).toBe("valid");
    await pool.query(`UPDATE roles SET event_access=false WHERE id=$1`, [other]);
    expect(await status(cert.code)).toBe("revoked");
    // Access back: a fresh certificate can be requested, the old one stays revoked.
    await pool.query(`UPDATE roles SET event_access=true WHERE id=$1`, [other]);
    const again = await request(person);
    expect(again.id).not.toBe(cert.id);
    await pool.query(`UPDATE roles SET deleted_at=now() WHERE id=$1`, [other]);
    expect(await status(again.code)).toBe("revoked");
  });

  it("leaves attendance certificates alone when access changes", async () => {
    await presence(person, 12);
    const attendance = (await issue(person, { variant: "hours" })).json();
    await pool.query(`DELETE FROM user_roles WHERE user_id=$1`, [person]);
    expect(await status(attendance.code)).toBe("valid");
  });
});

describe("single stored copy", () => {
  const get = (url: string, user?: number) =>
    app.inject({ method: "GET", url, headers: user ? asUser(user) : {} });
  const sha = (body: Buffer) => createHash("sha256").update(body).digest("hex");

  it("generates the copy once and serves the same bytes to owner, staff and the public viewer", async () => {
    await presence(person, 12);
    const cert = (await issue(person)).json();
    const stored = () =>
      pool.query(`SELECT pdf, pdf_sha256 FROM attendance_certificates WHERE id=$1`, [cert.id]);
    expect((await stored()).rows[0].pdf).toBeNull();
    const mine = await get(`/api/me/certificates/${cert.id}/pdf`, person);
    const [a, b] = await Promise.all([
      get(`/api/certificates/${cert.id}/pdf`, staff),
      get(`/api/public/certificates/${cert.code}/pdf`),
    ]);
    expect(mine.statusCode).toBe(200);
    expect(a.rawPayload.equals(mine.rawPayload)).toBe(true);
    expect(b.rawPayload.equals(mine.rawPayload)).toBe(true);
    const { rows } = await stored();
    expect(rows[0].pdf_sha256).toBe(sha(mine.rawPayload));
    expect(Buffer.from(rows[0].pdf).equals(mine.rawPayload)).toBe(true);
    expect((await PDFDocument.load(mine.rawPayload)).getPageCount()).toBe(1);
    expect(mine.rawPayload.length).toBeLessThan(20_000);
    const verified = (await get(`/api/public/certificates/${cert.code}`)).json();
    expect(verified.sha256).toBe(sha(mine.rawPayload));
    expect(verified.generatedAt).toEqual(expect.any(String));
    // Later changes to the account do not alter the issued copy.
    await pool.query(`UPDATE users SET dni='99999999R' WHERE id=$1`, [person]);
    const later = await get(`/api/me/certificates/${cert.id}/pdf`, person);
    expect(later.rawPayload.equals(mine.rawPayload)).toBe(true);
    expect(await pdfText(later.rawPayload)).toContain("12345678Z");
  });

  it("drops the copy on revocation and refuses a copy that fails its hash", async () => {
    await presence(person, 12);
    const cert = (await issue(person)).json();
    await get(`/api/me/certificates/${cert.id}/pdf`, person);
    await pool.query(`UPDATE attendance_certificates SET pdf_sha256=$2 WHERE id=$1`, [
      cert.id,
      "0".repeat(64),
    ]);
    const corrupt = await get(`/api/me/certificates/${cert.id}/pdf`, person);
    expect(corrupt.statusCode).toBe(500);
    expect(corrupt.json().error.details.code).toBe("certificate_copy_corrupt");
    const revoked = await app.inject({
      method: "POST",
      url: `/api/certificates/${cert.id}/revoke`,
      headers: asUser(staff),
      payload: { reason: "Mistake" },
    });
    expect(revoked.statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT pdf, pdf_sha256, pdf_generated_at FROM attendance_certificates WHERE id=$1`,
      [cert.id],
    );
    expect(rows[0]).toEqual({ pdf: null, pdf_sha256: null, pdf_generated_at: null });
    expect((await get(`/api/public/certificates/${cert.code}`)).json()).toMatchObject({
      status: "revoked",
      sha256: null,
    });
    expect((await get(`/api/me/certificates/${cert.id}/pdf`, person)).statusCode).toBe(409);
  });

  it("tells Attendance, Attendance hours and Activities apart", async () => {
    await presence(person, 12);
    await scanned(person, "Intro to Rust");
    await pool.query(`UPDATE users SET dni='12345678Z' WHERE id=$1`, [person]);
    await app.inject({
      method: "POST",
      url: `/api/users/${person}/certificate-approval`,
      headers: asUser(staff),
      payload: { certifiedHours: 30, reason: "Reviewed" },
    });
    const text: Record<string, string> = {};
    for (const variant of ["participation", "hours", "activities"]) {
      const cert = (await issue(person, { variant, locale: "en" })).json();
      const pdf = await get(`/api/me/certificates/${cert.id}/pdf`, person);
      text[variant] = await pdfText(pdf.rawPayload);
      const verified = await get(`/api/public/certificates/${cert.code}`);
      expect(verified.json().hours).toBe(variant === "hours" ? 30 : null);
    }
    expect(text.participation).not.toMatch(/hours of participation/);
    expect(text.hours).toMatch(/30 hours of participation/);
    expect(text.activities).not.toMatch(/hours of participation/);
    expect(text.activities).toContain("Intro to Rust");
  });

  it("replaces a certificate after more attendance without revoking the old one", async () => {
    await presence(person, 12);
    await scanned(person, "Intro to Rust");
    const { rows } = await pool.query(
      `SELECT id FROM certificate_types WHERE legacy_variant='activities'`,
    );
    const request = (refresh?: boolean) =>
      app.inject({
        method: "POST",
        url: "/api/me/certificates/issue",
        headers: asUser(person),
        payload: {
          typeId: rows[0].id,
          locale: "en",
          ...(refresh === undefined ? {} : { refresh }),
        },
      });
    const old = (await request()).json();
    const oldPdf = await get(`/api/me/certificates/${old.id}/pdf`, person);
    expect((await request(true)).json().id).toBe(old.id);
    await scanned(person, "Closing talk");
    const listed = (await get("/api/me/certificates", person)).json();
    expect(listed.certificates.find((c: { id: number }) => c.id === old.id).outdated).toBe(true);
    expect((await request()).json().id).toBe(old.id);
    const fresh = (await request(true)).json();
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.code).not.toBe(old.code);
    expect((await request(true)).json().id).toBe(fresh.id);
    const verifiedOld = (await get(`/api/public/certificates/${old.code}`)).json();
    expect(verifiedOld.status).toBe("valid");
    expect(verifiedOld.supersededAt).toEqual(expect.any(String));
    expect((await get(`/api/public/certificates/${fresh.code}`)).json().supersededAt).toBeNull();
    const oldAgain = await get(`/api/me/certificates/${old.id}/pdf`, person);
    expect(oldAgain.rawPayload.equals(oldPdf.rawPayload)).toBe(true);
    expect(await pdfText(oldAgain.rawPayload)).not.toContain("Closing talk");
    const current = await get(`/api/me/certificates/${fresh.id}/pdf`, person);
    expect(await pdfText(current.rawPayload)).toContain("Closing talk");
    const after = (await get("/api/me/certificates", person)).json();
    expect(after.certificates.filter((c: { outdated: boolean }) => c.outdated)).toHaveLength(0);
  });

  it("refuses an Activities certificate with nothing to list, and skips those people in bulk", async () => {
    await presence(person, 12);
    const refused = await issue(person, { variant: "activities" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details.code).toBe("certificate_no_activities");
    const bulk = await app.inject({
      method: "POST",
      url: "/api/certificates/bulk",
      headers: asUser(staff),
      payload: { variant: "activities", locale: "es" },
    });
    expect(bulk.json()).toEqual({ issued: 0, existing: 0, skipped: 1 });
    await scanned(person);
    expect((await issue(person, { variant: "activities" })).statusCode).toBe(200);
  });
});

describe("public verification rate limit", () => {
  it("answers 429 to a client iterating over codes", async () => {
    const codes = Array.from({ length: 70 }, (_, i) => String(i).padStart(24, "x"));
    const statuses: number[] = [];
    // The counter lives in Valkey for a minute: a fresh address per run.
    const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    for (const code of codes) {
      const res = await app.inject({
        method: "GET",
        url: `/api/public/certificates/${code}`,
        remoteAddress: address,
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 60).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(60).every((s) => s === 429)).toBe(true);
  });
});

describe("configured types and the durable guest register", () => {
  const tr = (value: string) => ({ es: value, gl: value, en: value });
  const definition = (patch = {}) => ({
    name: tr("Speaker"),
    title: tr("Speaker certificate"),
    body: tr("{recipient} gave {activity} at {event}."),
    enabled: true,
    attendancePolicy: false,
    selfService: false,
    audienceRoleIds: null,
    allowGuests: true,
    identityPolicy: "optional",
    requiresActivity: true,
    requiresEventEnd: false,
    demoRequirement: "none",
    demoChallengeId: null,
    exemptRoleIds: null,
    ...patch,
  });
  async function createType(patch = {}) {
    const res = await app.inject({
      method: "POST",
      url: "/api/certificates/types",
      headers: asUser(staff),
      payload: definition(patch),
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }
  async function configured(typeId: number, patch = {}, key?: string) {
    return app.inject({
      method: "POST",
      url: "/api/certificates/issue",
      headers: { ...asUser(staff), ...(key ? { "idempotency-key": key } : {}) },
      payload: {
        typeId,
        locale: "en",
        guestName: "Grace Hopper",
        activityName: "Compilers",
        ...patch,
      },
    });
  }

  it("keeps name-only guest documents searchable, downloadable and revocable after issuance", async () => {
    const type = await createType();
    const response = await configured(type.id, { includeIdentification: false }, "guest-speaker");
    expect(response.statusCode, response.body).toBe(200);
    const cert = response.json();
    expect(cert).toMatchObject({
      userId: null,
      recipientName: "Grace Hopper",
      typeName: "Speaker",
      activityName: "Compilers",
    });
    const replay = await configured(type.id, { includeIdentification: false }, "guest-speaker");
    expect(replay.json().id).toBe(cert.id);
    const register = await app.inject({
      method: "GET",
      url: "/api/certificates/issued",
      headers: asUser(staff),
    });
    expect(register.json().items).toContainEqual(
      expect.objectContaining({ id: cert.id, recipientName: "Grace Hopper" }),
    );
    const download = await app.inject({
      method: "GET",
      url: `/api/certificates/${cert.id}/pdf`,
      headers: asUser(staff),
    });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const noOwner = await app.inject({
      method: "GET",
      url: `/api/me/certificates/${cert.id}/pdf`,
      headers: asUser(person),
    });
    expect(noOwner.statusCode).toBe(403);
    const revoked = await app.inject({
      method: "POST",
      url: `/api/certificates/${cert.id}/revoke`,
      headers: asUser(staff),
      payload: { reason: "Wrong talk" },
    });
    expect(revoked.statusCode).toBe(200);
    const check = await app.inject({ method: "GET", url: `/api/public/certificates/${cert.code}` });
    expect(check.json()).toMatchObject({ status: "revoked", name: null });
    const pdf = await app.inject({
      method: "GET",
      url: `/api/certificates/${cert.id}/pdf`,
      headers: asUser(staff),
    });
    expect(pdf.statusCode).toBe(409);
    const after = await app.inject({
      method: "GET",
      url: "/api/certificates/issued",
      headers: asUser(staff),
    });
    expect(after.json().items[0].revokedAt).toBeTruthy();
  });

  it("enforces guest, activity and identification policies and keeps passport numbers private", async () => {
    const type = await createType({ identityPolicy: "required" });
    expect((await configured(type.id)).statusCode).toBe(400);
    expect((await configured(type.id, { activityName: "" })).statusCode).toBe(400);
    expect(
      (await configured(type.id, { documentNumber: "P12345", includeIdentification: false }))
        .statusCode,
    ).toBe(400);
    const issued = await configured(type.id, {
      documentNumber: "P12345",
      documentKind: "passport",
    });
    expect(issued.statusCode, issued.body).toBe(200);
    const cert = issued.json();
    const verification = await app.inject({
      method: "GET",
      url: `/api/public/certificates/${cert.code}`,
    });
    expect(verification.body).not.toContain("P12345");
    const registry = await app.inject({
      method: "GET",
      url: "/api/certificates/issued",
      headers: asUser(staff),
    });
    expect(registry.body).not.toContain("P12345");
    const { rows } = await pool.query(
      "SELECT recipient_document_number, snapshot FROM attendance_certificates WHERE id=$1",
      [cert.id],
    );
    expect(rows[0].recipient_document_number).toBe("P12345");
    expect(JSON.stringify(rows[0].snapshot)).not.toContain("P12345");
    const noGuests = await createType({ allowGuests: false });
    expect((await configured(noGuests.id)).statusCode).toBe(400);
    const noId = await createType({ identityPolicy: "none" });
    expect((await configured(noId.id, { documentNumber: "123" })).statusCode).toBe(400);
  });

  it("uses stored role membership and allows separate talks for the same account", async () => {
    const { rows } = await pool.query("SELECT role_id FROM user_roles WHERE user_id=$1 LIMIT 1", [
      staff,
    ]);
    const roleId = rows[0].role_id;
    const type = await createType({ audienceRoleIds: [roleId], allowGuests: false });
    const request = (userId: number, activityName = "Compilers") =>
      app.inject({
        method: "POST",
        url: "/api/certificates/issue",
        headers: asUser(staff),
        payload: { typeId: type.id, locale: "en", userId, activityName },
      });
    expect((await request(person)).statusCode).toBe(403);
    const first = await request(staff);
    expect(first.statusCode, first.body).toBe(200);
    expect((await request(staff)).json().id).toBe(first.json().id);
    const second = await request(staff, "Debugging");
    expect(second.statusCode).toBe(200);
    expect(second.json().id).not.toBe(first.json().id);
    const self = await app.inject({
      method: "POST",
      url: "/api/me/certificates/issue",
      headers: asUser(staff),
      payload: { typeId: type.id, locale: "en" },
    });
    expect(self.statusCode).toBe(403);
  });

  it("freezes issued wording, checks revisions and keeps old downloads when a type is disabled", async () => {
    const type = await createType();
    const cert = (await configured(type.id)).json();
    const updated = definition({
      enabled: false,
      title: tr("New title"),
      body: tr("Changed wording"),
    });
    const update = () =>
      app.inject({
        method: "PUT",
        url: `/api/certificates/types/${type.id}`,
        headers: asUser(staff),
        payload: { revision: type.revision, definition: updated },
      });
    expect((await update()).statusCode).toBe(200);
    expect((await update()).statusCode).toBe(409);
    expect((await configured(type.id)).statusCode).toBe(409);
    const { rows } = await pool.query("SELECT snapshot FROM attendance_certificates WHERE id=$1", [
      cert.id,
    ]);
    expect(rows[0].snapshot.templateBody).toBe("Grace Hopper gave Compilers at HackUDC.");
    expect(rows[0].snapshot.templateTitle).toBe("Speaker certificate");
    const pdf = await app.inject({
      method: "GET",
      url: `/api/certificates/${cert.id}/pdf`,
      headers: asUser(staff),
    });
    expect(pdf.statusCode).toBe(200);
  });

  it("does not revoke speaker documents when attendance awards change", async () => {
    const type = await createType({ requiresActivity: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/certificates/issue",
      headers: asUser(staff),
      payload: { typeId: type.id, locale: "en", userId: person },
    });
    expect(response.statusCode, response.body).toBe(200);
    await app.inject({
      method: "PUT",
      url: "/api/certificates/settings",
      headers: asUser(staff),
      payload: { awardHours: 37 },
    });
    await app.inject({
      method: "POST",
      url: `/api/users/${person}/certificate-approval`,
      headers: asUser(staff),
      payload: { certifiedHours: 31, reason: "Reviewed all activities" },
    });
    const { rows } = await pool.query(
      "SELECT revoked_at FROM attendance_certificates WHERE id=$1",
      [response.json().id],
    );
    expect(rows[0].revoked_at).toBeNull();
  });

  it("offers eligible configured attendance types through self-service", async () => {
    await presence(person, 12);
    const type = await createType({
      attendancePolicy: true,
      selfService: true,
      requiresActivity: false,
      allowGuests: false,
    });
    const overview = await app.inject({
      method: "GET",
      url: "/api/me/certificates",
      headers: asUser(person),
    });
    expect(overview.json().types).toContainEqual(expect.objectContaining({ id: type.id }));
    const issued = await app.inject({
      method: "POST",
      url: "/api/me/certificates/issue",
      headers: asUser(person),
      payload: { typeId: type.id, locale: "gl" },
    });
    expect(issued.statusCode, issued.body).toBe(200);
    expect(issued.json()).toMatchObject({ typeId: type.id, userId: person, locale: "gl" });
  });

  it("requires an explicit attendance award for guests and preserves it over the standard award", async () => {
    const type = await createType({ attendancePolicy: true, requiresActivity: false });
    expect((await configured(type.id)).statusCode).toBe(400);
    await app.inject({
      method: "PUT",
      url: "/api/certificates/settings",
      headers: asUser(staff),
      payload: { awardHours: 37 },
    });
    const issued = await configured(type.id, {
      certifiedHours: 27.5,
      overrideReason: "Reviewed the guest's attendance",
    });
    expect(issued.statusCode, issued.body).toBe(200);
    const { rows } = await pool.query("SELECT snapshot FROM attendance_certificates WHERE id=$1", [
      issued.json().id,
    ]);
    expect(rows[0].snapshot).toMatchObject({ hours: 27.5, manuallyCertified: true });
  });

  it("predefines accepted spot for all event-access roles without attendance, demo or accepted application", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/certificates/settings",
      headers: asUser(staff),
      payload: { minHours: null },
    });
    const catalog = await app.inject({
      method: "GET",
      url: "/api/certificates/types",
      headers: asUser(staff),
    });
    expect(catalog.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legacyVariant: "participation",
          name: expect.objectContaining({ en: "Attendance" }),
        }),
        expect.objectContaining({ legacyVariant: "hours" }),
        expect.objectContaining({
          legacyVariant: "accepted_spot",
          attendancePolicy: false,
          selfService: true,
          audienceRoleIds: null,
        }),
      ]),
    );
    const accepted = catalog
      .json()
      .items.find((item: { legacyVariant: string }) => item.legacyVariant === "accepted_spot");
    for (const name of ["Staff", "Sponsor", "Mentor", "Another custom role"]) {
      const userId = await createUser({ name });
      const roleId = await createRole([], { name: `Certificate ${name}`, eventAccess: true });
      await assignRole(userId, roleId);
      const overview = await app.inject({
        method: "GET",
        url: "/api/me/certificates",
        headers: asUser(userId),
      });
      expect(overview.json().eligibility.eligible).toBe(false);
      expect(overview.json().types).toContainEqual(expect.objectContaining({ id: accepted.id }));
      const issue = () =>
        app.inject({
          method: "POST",
          url: "/api/me/certificates/issue",
          headers: asUser(userId),
          payload: { typeId: accepted.id, locale: "en" },
        });
      const cert = await issue();
      expect(cert.statusCode, cert.body).toBe(200);
      expect((await issue()).json().id).toBe(cert.json().id);
      const pdf = await app.inject({
        method: "GET",
        url: `/api/me/certificates/${cert.json().id}/pdf`,
        headers: asUser(userId),
      });
      expect(pdf.statusCode).toBe(200);
      await pool.query("DELETE FROM user_roles WHERE user_id=$1", [userId]);
      expect((await issue()).statusCode).toBe(403);
    }
    const outsider = await createUser();
    const denied = await app.inject({
      method: "POST",
      url: "/api/me/certificates/issue",
      headers: asUser(outsider),
      payload: { typeId: accepted.id, locale: "en" },
    });
    expect(denied.statusCode).toBe(403);
    const { id: _id, revision, legacyVariant: _legacy, ...definition } = accepted;
    const restricted = await app.inject({
      method: "PUT",
      url: `/api/certificates/types/${accepted.id}`,
      headers: asUser(staff),
      payload: { revision, definition: { ...definition, audienceRoleIds: [] } },
    });
    expect(restricted.statusCode).toBe(400);
  });

  it("denies certificate management without the capability", async () => {
    for (const url of [
      "/api/certificates/types",
      "/api/certificates/issued",
      "/api/certificates/recipients?q=Ada",
    ]) {
      expect((await app.inject({ method: "GET", url, headers: asUser(person) })).statusCode).toBe(
        403,
      );
    }
  });
});
