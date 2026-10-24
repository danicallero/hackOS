import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { PDFDocument } from "pdf-lib";
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
    `UPDATE certificate_settings SET min_hours = 10, min_review_hours = NULL, award_hours = NULL, requires_demo = false, issuer_name = DEFAULT`,
  );
  await pool.query(`DELETE FROM certificate_types WHERE legacy_variant IS NULL`);
  await pool.query(
    `UPDATE certificate_types SET enabled=true, attendance_policy=true, self_service=true, audience_role_ids=NULL, allow_guests=false, identity_policy='optional', requires_activity=false, body_i18n=NULL WHERE legacy_variant IN ('participation','hours','activities')`,
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
        updateSettings(staff, { requiresDemo: true }),
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
      expect(await readSettings()).toMatchObject({ minHours: 20, requiresDemo: true });
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
      payload: { minHours: 20, requiresDemo: true },
    });
    expect(updated.json()).toMatchObject({ minHours: 20, requiresDemo: true });
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
    const cert = (await issue(person)).json();
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
    const reviewed = (await issue(person)).json();
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

describe("CSV footer", () => {
  const get = (url: string, user: number) =>
    app.inject({ method: "GET", url, headers: asUser(user) });

  it("stamps the footer on participant copies and on staff copies, not on the bare document", async () => {
    await presence(person, 12);
    const cert = (await issue(person)).json();
    const mine = await get(`/api/me/certificates/${cert.id}/pdf`, person);
    const bare = await get(`/api/certificates/${cert.id}/pdf`, staff);
    const staffCopy = await get(`/api/certificates/${cert.id}/pdf?copy=true`, staff);
    // The footer adds a QR image and text: the bare document is smaller.
    expect(bare.rawPayload.length).toBeLessThan(mine.rawPayload.length);
    expect(staffCopy.rawPayload.length).toBeGreaterThan(bare.rawPayload.length);
    expect((await PDFDocument.load(mine.rawPayload)).getPageCount()).toBe(1);
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
    for (const copy of [false, true]) {
      const pdf = await app.inject({
        method: "GET",
        url: `/api/certificates/${cert.id}/pdf?copy=${copy}`,
        headers: asUser(staff),
      });
      expect(pdf.statusCode, pdf.body).toBe(200);
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    }
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
      payload: { minHours: null, requiresDemo: true },
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
