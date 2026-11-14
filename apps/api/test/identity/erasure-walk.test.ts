import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { admitParticipant } from "../projects/fixtures.js";

/**
 * Multi-edition erasure (H54, H8): deleting or anonymizing a person reaches
 * every edition, closed ones included. The walk discovers every column with a
 * foreign key to users(id) from the catalog and fails when any row still
 * references the removed id (a nullable reference must have been NULLed).
 */

const getApp = useTestApp();
let app: App;

beforeEach(async () => {
  app = await getApp();
});

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

/** Every column holding a foreign key to users(id), from pg_catalog. */
async function foreignKeysToUsers(): Promise<{ table: string; column: string }[]> {
  const pool = await db();
  const { rows } = await pool.query<{ tbl: string; col: string }>(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass
      ORDER BY 1, 2`,
  );
  return rows.map((row) => ({ table: row.tbl, column: row.col }));
}

/** Runs `fn` with the viewed edition set for every statement of one connection. */
async function inEdition<T>(eventKey: string, fn: (client: pg.PoolClient) => Promise<T>) {
  const pool = await db();
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('hackos.edition', $1, false)`, [eventKey]);
    return await fn(client);
  } finally {
    client.release(true);
  }
}

async function createEditions() {
  const pool = await db();
  await pool.query(
    `INSERT INTO editions (event_key, name, status, starts_at, ends_at)
     VALUES ('e1', 'E1', 'active', '2025-02-27T09:00:00Z', '2025-03-01T17:00:00Z')`,
  );
  await pool.query(
    `INSERT INTO event_config (id, name, venue_name, event_starts_at, event_ends_at)
     VALUES (1, 'HackUDC', 'FIC', '2026-02-27T09:00:00Z', '2026-03-01T17:00:00Z')
     ON CONFLICT (id) DO UPDATE SET name = 'HackUDC', venue_name = 'FIC',
       event_starts_at = '2026-02-27T09:00:00Z', event_ends_at = '2026-03-01T17:00:00Z'`,
  );
  await pool.query(
    `UPDATE certificate_settings SET min_hours = 10, min_review_hours = NULL, award_hours = NULL`,
  );
  await pool.query(`DELETE FROM certificate_types WHERE legacy_variant IS NULL`);
  await pool.query(
    `UPDATE certificate_types SET enabled=true, attendance_policy=true, self_service=true, audience_role_ids=NULL, allow_guests=false, identity_policy='optional', requires_activity=false, demo_requirement='none', demo_challenge_id=NULL, exempt_role_ids=NULL, body_i18n=NULL WHERE legacy_variant IN ('participation','hours','activities')`,
  );
}

/** Rows in as many user-referencing tables as practical, for one edition. */
async function seedEdition(userId: number, other: number, ek: string, withCheckIn: boolean) {
  await inEdition(ek, async (c) => {
    const app = await c.query(
      `INSERT INTO applications (name, template) VALUES ($1, '{}'::jsonb) RETURNING id`,
      [`App ${ek}`],
    );
    await c.query(
      `INSERT INTO application_form_versions (application_id, version, template, sections)
       SELECT id, current_form_version, template, sections FROM applications WHERE id = $1
       ON CONFLICT (application_id, version) DO NOTHING`,
      [app.rows[0].id],
    );
    await c.query(
      `INSERT INTO application_responses (user_id, application_id, application_form_version_id, status)
       SELECT $1, $2, fv.id, 'accepted' FROM application_form_versions fv
        WHERE fv.application_id = $2 LIMIT 1`,
      [userId, app.rows[0].id],
    );
    await c.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by) VALUES
         ($1, 'in', now() - interval '13 hours', $2), ($1, 'out', now() - interval '1 hour', $2)`,
      [userId, other],
    );
    if (withCheckIn) {
      await c.query(`INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, $2, $3)`, [
        userId,
        `BADGE-${ek}`,
        other,
      ]);
    }
    const activity = await c.query(
      `INSERT INTO activities (name, category) VALUES ($1, 'workshop') RETURNING id`,
      [`Workshop ${ek}`],
    );
    await c.query(
      `INSERT INTO activity_logs (user_id, activity_id, logged_by) VALUES ($1, $2, $3)`,
      [userId, activity.rows[0].id, other],
    );
    await c.query(`INSERT INTO activity_rsvps (user_id, activity_id) VALUES ($1, $2)`, [
      userId,
      activity.rows[0].id,
    ]);
    await c.query(`INSERT INTO tickets (user_id, token) VALUES ($1, $2)`, [userId, `ticket-${ek}`]);
    await c.query(
      `INSERT INTO wallet_passes (user_id, purpose, platform, serial_number, authentication_token)
       VALUES ($1, 'badge', 'apple', $2, $3)`,
      [userId, `serial-${ek}`, `auth-${ek}`],
    );
    await c.query(
      `INSERT INTO help_requests
         (requester_id, claimed_by, description, location, routing, status, claimed_at, meeting_mode)
       VALUES ($1, $2, 'help me', 'room 1', 'none', $3, now(), 'on_my_way')`,
      [userId, other, ek === "e1" ? "resolved" : "claimed"],
    );
    await c.query(`INSERT INTO helper_profiles (user_id) VALUES ($1)`, [userId]);
    await c.query(`INSERT INTO mentor_profiles (user_id) VALUES ($1)`, [userId]);
    await c.query(
      `INSERT INTO onboarding_step_states (user_id, step, status, config_revision)
       VALUES ($1, 'welcome', 'completed', 1)`,
      [userId],
    );
    await c.query(`INSERT INTO diary_entries (owner_id, target_user_id) VALUES ($1, $2)`, [
      userId,
      other,
    ]);
    await c.query(`INSERT INTO diary_entries (owner_id, target_user_id) VALUES ($1, $2)`, [
      other,
      userId,
    ]);
    const repo = await c.query(
      `INSERT INTO repos (name, created_by, github_url) VALUES ($1, $2, $3) RETURNING id`,
      [`Repo ${ek}`, userId, `https://github.com/example/${ek}`],
    );
    await c.query(`INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`, [
      repo.rows[0].id,
      userId,
    ]);
    await c.query(`INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`, [
      repo.rows[0].id,
      other,
    ]);
    await c.query(
      `INSERT INTO github_repo_links (repo_id, installation_id, github_repo_id, full_name, linked_by)
       VALUES ($1, 1, $2, $3, $4)`,
      [repo.rows[0].id, ek === "e1" ? 9001 : 9002, `example/${ek}`, userId],
    );
    await c.query(`INSERT INTO enterprises (name, director_id) VALUES ($1, $2)`, [
      `Org ${ek}`,
      userId,
    ]);
    await c.query(`INSERT INTO announcements (title, body, author_id) VALUES ('t', 'b', $1)`, [
      userId,
    ]);
    await c.query(
      `INSERT INTO certificate_approvals (user_id, certified_hours, reason, approved_by)
       VALUES ($1, 12, 'seeded', $2)`,
      [userId, other],
    );
    // A role in the edition (participation), copied from the default edition's one.
    await c.query(
      `INSERT INTO user_roles (user_id, role_id, event_key)
       SELECT user_id, role_id, $2 FROM user_roles WHERE user_id = $1 AND event_key = 'default'
       ON CONFLICT DO NOTHING`,
      [userId, ek],
    );
    await c.query(
      `INSERT INTO badge_id_history (user_id, badge_id, event_key) VALUES ($1, $2, $3)`,
      [userId, `OLD-${ek}`, ek],
    );
  });
}

async function issueCertificate(userId: number, edition?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/me/certificates",
    headers: { ...asUser(userId), ...(edition ? { "x-edition": edition } : {}) },
    payload: { variant: "participation", locale: "es" },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: number; code: string; edition: { eventKey: string } };
}

async function sha256Of(certificateId: number): Promise<string> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT pdf_sha256 FROM attendance_certificates WHERE id = $1`,
    [certificateId],
  );
  return rows[0].pdf_sha256;
}

/** Builds a person active in two editions, e1 closed afterwards. */
async function seedPerson(withCheckIn: boolean) {
  const pool = await db();
  await createEditions();
  const admin = await createUserWithCapabilities(["*"]);
  const other = await createUser({ name: "Colleague" });
  const person = await createUser({ name: "Erased Person", email: "erased@example.test" });
  await pool.query(`UPDATE users SET surname = 'Walker', dni = '12345678Z' WHERE id = $1`, [
    person,
  ]);
  await admitParticipant(person); // default edition role + application
  await seedEdition(person, other, "default", withCheckIn);
  await seedEdition(person, other, "e1", withCheckIn);
  await pool.query(`UPDATE users SET badge_id = 'CURRENT-BADGE' WHERE id = $1`, [person]);

  const current = await issueCertificate(person);
  const past = await issueCertificate(person, "e1");
  expect(past.edition.eventKey).toBe("e1");
  // First view stores the PDF copy (and its fingerprint) of each certificate.
  for (const cert of [current, past]) {
    const view = await app.inject({ method: "GET", url: `/api/public/certificates/${cert.code}` });
    expect(view.statusCode).toBe(200);
  }
  await pool.query(
    `UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'e1'`,
  );
  return { admin, other, person, current, past };
}

async function removePerson(admin: number, person: number) {
  const { runAccountRemoval } = await import("../../src/modules/identity/removal.js");
  const result = await runAccountRemoval({ targetId: person, actorId: admin, source: "admin" });
  expect(result.status).toBe("completed");
}

/** Fails when any FK-to-users column still references the id, or is not NULL. */
async function walk(userId: number) {
  const pool = await db();
  const dangling: string[] = [];
  const keys = await foreignKeysToUsers();
  expect(keys.length).toBeGreaterThan(40); // the catalog walk really discovered the schema
  for (const { table, column } of keys) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`,
      [userId],
    );
    if (rows[0].n > 0) dangling.push(`${table}.${column}`);
  }
  expect(dangling).toEqual([]);
}

/** Tables referencing users that the seed filled in the edition (sanity of the walk). */
async function referencedTables(userId: number): Promise<Set<string>> {
  const pool = await db();
  const seen = new Set<string>();
  for (const { table, column } of await foreignKeysToUsers()) {
    const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`, [
      userId,
    ]);
    if (rows.length > 0) seen.add(table);
  }
  return seen;
}

describe("erasure walk across editions (H54)", () => {
  it("full deletion leaves no row referencing the user in any edition", async () => {
    const { admin, person } = await seedPerson(false);
    const pool = await db();
    const before = await referencedTables(person);
    for (const table of [
      "user_roles",
      "tickets",
      "time_logs",
      "badge_id_history",
      "certificate_approvals",
      "attendance_certificates",
      "helper_profiles",
      "mentor_profiles",
      "wallet_passes",
      "submissions",
      "diary_entries",
      "application_responses",
      "activity_logs",
      "activity_rsvps",
    ]) {
      expect(before, table).toContain(table);
    }
    const { rows: editionsBefore } = await pool.query(
      `SELECT DISTINCT event_key FROM tickets WHERE user_id = $1 ORDER BY 1`,
      [person],
    );
    expect(editionsBefore.map((r) => r.event_key)).toEqual(["default", "e1"]);

    await removePerson(admin, person);

    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [person])).rowCount).toBe(0);
    await walk(person);
    expect((await pool.query(`SELECT 1 FROM badge_id_history`)).rowCount).toBe(0);
    // Repository links of a repo the person owned are cleared on the surviving project.
    expect((await pool.query(`SELECT 1 FROM github_repo_links`)).rowCount).toBe(0);
    const { rows: repos } = await pool.query(`SELECT github_url, created_by FROM repos`);
    expect(repos.every((r) => r.github_url === null && r.created_by === null)).toBe(true);
    // The deleted person's credentials are revoked once per edition they belonged to.
    const { rows: revoked } = await pool.query(
      `SELECT event_key, count(*)::int AS n FROM scanner_revoked_tickets GROUP BY 1 ORDER BY 1`,
    );
    expect(revoked).toEqual([
      { event_key: "default", n: 1 },
      { event_key: "e1", n: 1 },
    ]);
    const { rows: badges } = await pool.query(
      `SELECT event_key FROM scanner_revoked_badges ORDER BY event_key`,
    );
    expect(badges.map((r) => r.event_key)).toContain("e1");
  });

  it("anonymization deletes both editions' certificates, hides their codes and records per-edition participation", async () => {
    const { admin, person, current, past } = await seedPerson(true);
    const pool = await db();
    const currentHash = await sha256Of(current.id);
    const pastHash = await sha256Of(past.id);

    // Before: a closed edition's certificate still verifies and names its edition.
    const live = await app.inject({ method: "GET", url: `/api/public/certificates/${past.code}` });
    expect(live.statusCode).toBe(200);
    expect(live.json().edition).toEqual({ eventKey: "e1", name: "E1" });

    await removePerson(admin, person);

    await walk(person);
    expect((await pool.query(`SELECT 1 FROM attendance_certificates`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM certificate_approvals`)).rowCount).toBe(0);
    for (const cert of [current, past]) {
      const res = await app.inject({ method: "GET", url: `/api/public/certificates/${cert.code}` });
      expect(res.statusCode).toBe(404);
    }
    for (const hash of [currentHash, pastHash]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/public/certificates/by-hash/${hash}`,
      });
      expect(res.statusCode).toBe(404);
    }

    const { rows: participants } = await pool.query(
      `SELECT id, guaranteed_presence_minutes FROM anonymous_participants`,
    );
    expect(participants).toHaveLength(1);
    const { rows: perEdition } = await pool.query(
      `SELECT event_key, guaranteed_presence_minutes FROM anonymous_participant_editions
        WHERE anonymous_participant_id = $1 ORDER BY event_key`,
      [participants[0].id],
    );
    expect(perEdition.map((r) => r.event_key)).toEqual(["default", "e1"]);
    expect(perEdition.every((r) => r.guaranteed_presence_minutes > 0)).toBe(true);
    // Each edition's minutes use only that edition's presence (12h seeded in each).
    expect(perEdition.map((r) => r.guaranteed_presence_minutes)).toEqual([720, 720]);
    // No column of either table can point back at a person.
    const { rows: columns } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'anonymous_participant_editions'`,
    );
    expect(columns.map((r) => r.column_name).sort()).toEqual([
      "anonymous_participant_id",
      "event_key",
      "guaranteed_presence_minutes",
    ]);
    expect(CAPABILITIES).toBeDefined();
  });
});
