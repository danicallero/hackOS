import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { admitParticipant, createChallenge } from "../projects/fixtures.js";

/** #934, #935: the owner's public profile and the saved-person card. */

const VISIBLE = {
  directoryVisible: true,
  showSurname: false,
  showPhoto: false,
  showProject: true,
  headline: null,
  locationNote: null,
};

let app: App;
let reader: number;

beforeAll(async () => {
  app = await buildTestApp();
});
beforeEach(async () => {
  await truncateAll();
  reader = await person("Reader", "Zed");
});
afterAll(async () => {
  await app.close();
});

async function person(name: string, surname: string, email = `${crypto.randomUUID()}@dir.test`) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, surname, email_verified, dni, badge_id)
     VALUES ($1, $2, $3, true, $4, $5) RETURNING id`,
    [email, name, surname, `DNI-${crypto.randomUUID()}`, `B-${crypto.randomUUID()}`],
  );
  const id = rows[0].id as number;
  // #934: a stored photo key; the object itself is exercised in profile-files.test.ts.
  await pool.query(`UPDATE users SET photo_key = $2, photo_updated_at = now() WHERE id = $1`, [
    id,
    `profiles/${id}/photo/${"a".repeat(32)}.png`,
  ]);
  await admitParticipant(id);
  return id;
}

let keySeq = 0;
function putProfile(userId: number, payload: Record<string, unknown>, key = `k-${++keySeq}`) {
  return app.inject({
    method: "PUT",
    url: "/api/me/public-profile",
    headers: { ...asUser(userId), "idempotency-key": key },
    payload,
  });
}

/** Saves `target` in the reader's diary, as a badge scan would (#935). */
async function save(target: number, as = reader) {
  await pool.query(`INSERT INTO diary_entries (owner_id, target_user_id) VALUES ($1, $2)`, [
    as,
    target,
  ]);
}

function card(id: number, as = reader) {
  return app.inject({ method: "GET", url: `/api/directory/${id}`, headers: asUser(as) });
}

async function publishChallenge(title: string) {
  const id = await createChallenge(title);
  await pool.query(`UPDATE challenges SET visibility = 'visible' WHERE id = $1`, [id]);
  return id;
}

async function activeRepo(name: string, members: number[], challengeIds: number[]) {
  const { rows } = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [name]);
  const repoId = rows[0].id as number;
  for (const userId of members) {
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`,
      [repoId, userId],
    );
  }
  for (const challengeId of challengeIds) {
    await pool.query(`INSERT INTO queue_entries (challenge_id, repo_id) VALUES ($1, $2)`, [
      challengeId,
      repoId,
    ]);
  }
  return repoId;
}

describe("public profile owner routes (#934)", () => {
  it("records an explicit opt-out without sharing or claiming consent, once across concurrent requests", async () => {
    const me = await person("Private", "Person");
    const body = { ...VISIBLE, directoryVisible: false, completeOnboarding: true };
    const results = await Promise.all([putProfile(me, body), putProfile(me, body)]);
    for (const result of results) {
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ directoryVisible: false, consentedAt: null });
      expect(result.json().onboardingCompletedAt).toEqual(expect.any(String));
    }
    expect(results[0].json().onboardingCompletedAt).toBe(results[1].json().onboardingCompletedAt);
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'user_public_profile' AND entity_id = $1`,
      [me],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({ onboardingCompleted: true, directoryVisible: false });
    const read = await app.inject({
      method: "GET",
      url: "/api/me/public-profile",
      headers: asUser(me),
    });
    expect(read.json().onboardingCompletedAt).toBe(results[0].json().onboardingCompletedAt);
  });

  it("completes onboarding with an explicitly shared profile", async () => {
    const me = await person("Public", "Person");
    const response = await putProfile(me, {
      ...VISIBLE,
      headline: "Builder",
      completeOnboarding: true,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      directoryVisible: true,
      headline: "Builder",
      onboardingCompletedAt: expect.any(String),
      consentedAt: expect.any(String),
    });
  });

  it("does not complete onboarding for a non-attendee", async () => {
    const me = await createUser();
    const response = await putProfile(me, {
      ...VISIBLE,
      directoryVisible: false,
      completeOnboarding: true,
    });
    expect(response.statusCode).toBe(403);
    const { rows } = await pool.query(`SELECT 1 FROM user_public_profiles WHERE user_id = $1`, [
      me,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("defaults to hidden and previews the card", async () => {
    const me = await person("José", "García");
    const res = await app.inject({
      method: "GET",
      url: "/api/me/public-profile",
      headers: asUser(me),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      directoryVisible: false,
      showSurname: false,
      showProject: true,
      consentedAt: null,
      preview: { userId: me, displayName: "José G.", photoUrl: null, project: null },
    });
    const { rows } = await pool.query(`SELECT 1 FROM user_public_profiles WHERE user_id = $1`, [
      me,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("previews the project and challenges without a saved row", async () => {
    const challenge = await publishChallenge("Preview");
    const me = await person("Uxía", "Rey");
    const repoId = await activeRepo("Unsaved", [me], [challenge]);
    const res = await app.inject({
      method: "GET",
      url: "/api/me/public-profile",
      headers: asUser(me),
    });
    expect(res.json().preview).toMatchObject({
      displayName: "Uxía R.",
      projects: [{ kind: "project", id: repoId, name: "Unsaved" }],
      challenges: [{ id: challenge, name: "Preview" }],
    });
  });

  it("trims text, clears empty text and stamps consent only on the hidden→visible transition", async () => {
    const me = await person("Ana", "Pérez");
    const first = await putProfile(me, {
      ...VISIBLE,
      showSurname: true,
      headline: "  Backend  ",
      locationNote: "   ",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      directoryVisible: true,
      headline: "Backend",
      locationNote: null,
      preview: { displayName: "Ana Pérez", headline: "Backend" },
    });
    const consentedAt = first.json().consentedAt;
    expect(consentedAt).toEqual(expect.any(String));

    const again = await putProfile(me, { ...VISIBLE, headline: "Frontend" });
    expect(again.json().consentedAt).toBe(consentedAt);

    await putProfile(me, { ...VISIBLE, directoryVisible: false });
    const reOptIn = await putProfile(me, VISIBLE);
    expect(reOptIn.json().consentedAt).not.toBe(consentedAt);
  });

  it("rejects invalid text, missing event access and removal-pending accounts", async () => {
    const me = await person("Ana", "Pérez");
    expect((await putProfile(me, { ...VISIBLE, headline: "x".repeat(81) })).statusCode).toBe(400);
    expect((await putProfile(me, { ...VISIBLE, locationNote: "x".repeat(61) })).statusCode).toBe(
      400,
    );
    expect((await putProfile(me, { ...VISIBLE, headline: "a\u0007b" })).statusCode).toBe(400);
    expect((await putProfile(me, { directoryVisible: true })).statusCode).toBe(400);

    const outsider = await createUser();
    expect((await putProfile(outsider, VISIBLE)).statusCode).toBe(403);

    await pool.query(
      `UPDATE users SET account_state = 'removal_pending', removal_started_at = now() WHERE id = $1`,
      [me],
    );
    // The H1 caller gate answers 404 for a removal-pending caller; the service keeps an
    // explicit 409 for any caller that reaches it.
    expect((await putProfile(me, VISIBLE)).statusCode).toBe(404);
    const { updateMyPublicProfile } = await import("../../src/modules/directory/service.js");
    await expect(updateMyPublicProfile(me, VISIBLE)).rejects.toMatchObject({ statusCode: 409 });
    const { rows } = await pool.query(
      `SELECT 1 FROM audit_log WHERE entity_type = 'user_public_profile'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("audits each update without free text and replays an idempotent retry", async () => {
    const me = await person("Ana", "Pérez");
    const payload = { ...VISIBLE, headline: "Secret words" };
    const first = await putProfile(me, payload, "same-key");
    const replay = await putProfile(me, payload, "same-key");
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const { rows } = await pool.query(
      `SELECT action, before, after FROM audit_log WHERE entity_type = 'user_public_profile'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "public_profile.updated",
      before: { directoryVisible: false },
      after: { directoryVisible: true },
    });
    expect(rows[0].after.changedFields).toEqual(["directoryVisible", "headline"]);
    expect(JSON.stringify(rows[0])).not.toContain("Secret words");
  });

  it("writes nothing for a save that repeats the stored settings", async () => {
    const me = await person("Ana", "Pérez");
    const first = await putProfile(me, { ...VISIBLE, headline: "Same" });
    const { rows: before } = await pool.query(
      `SELECT updated_at FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    const again = await putProfile(me, { ...VISIBLE, headline: "  Same " });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    const { rows: after } = await pool.query(
      `SELECT updated_at FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    expect(after).toEqual(before);
    const hiddenDefaults = await person("No", "Row");
    expect(
      (await putProfile(hiddenDefaults, { ...VISIBLE, directoryVisible: false })).statusCode,
    ).toBe(200);
    const { rows: audits } = await pool.query(
      `SELECT entity_id FROM audit_log WHERE action = 'public_profile.updated'`,
    );
    expect(audits).toEqual([{ entity_id: String(me) }]);
    const { rows: noRow } = await pool.query(
      `SELECT 1 FROM user_public_profiles WHERE user_id = $1`,
      [hiddenDefaults],
    );
    expect(noRow).toHaveLength(0);
  });

  it("serializes concurrent first writes into one row with consent stamped once", async () => {
    const me = await person("Ana", "Pérez");
    const results = await Promise.all([putProfile(me, VISIBLE), putProfile(me, VISIBLE)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const { rows } = await pool.query(
      `SELECT consented_at FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    expect(rows).toHaveLength(1);
    expect(results[0].json().consentedAt).toBe(results[1].json().consentedAt);
  });
});

describe("saved profile reads (#934, #935)", () => {
  it("shows a saved person's card with project and published challenges, without private fields", async () => {
    const challenge = await publishChallenge("Green AI");
    const hidden = await createChallenge("Draft challenge");
    const jose = await person("José", "Álvarez");
    const teammate = await person("Hidden", "Mate");
    await activeRepo("Neural Beans", [jose, teammate], [challenge, hidden]);
    await putProfile(jose, { ...VISIBLE, showPhoto: true, locationNote: "Planta 1, mesa 12" });
    await save(jose);

    const res = await card(jose);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      userId: jose,
      displayName: "José Á.",
      photoUrl: `/api/users/${jose}/photo?v=aaaaaaaaaaaa`,
      headline: null,
      bio: null,
      locationNote: "Planta 1, mesa 12",
      socials: [],
      cvUrl: null,
      projects: [{ kind: "project", id: expect.any(Number), name: "Neural Beans" }],
      project: { kind: "project", id: expect.any(Number), name: "Neural Beans" },
      challenges: [{ id: challenge, name: "Green AI" }],
    });
    const body = res.body;
    for (const forbidden of [
      "email",
      "dni",
      "badge",
      "intoleran",
      "Mate",
      "@dir.test",
      "DNI-",
      "profiles/",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("ignores cancelled and disqualified queue entries in challenges", async () => {
    const kept = await publishChallenge("Kept");
    const cancelled = await publishChallenge("Cancelled");
    const disqualified = await publishChallenge("Disqualified");
    const me = await person("Brais", "Lago");
    const repoId = await activeRepo("Queued", [me], [kept, cancelled, disqualified]);
    await pool.query(
      `UPDATE queue_entries SET status = CASE challenge_id WHEN $2 THEN 'cancelled'::queue_status ELSE 'disqualified'::queue_status END
        WHERE repo_id = $1 AND challenge_id IN ($2, $3)`,
      [repoId, cancelled, disqualified],
    );
    await putProfile(me, VISIBLE);
    await save(me);
    expect((await card(me)).json().challenges).toEqual([{ id: kept, name: "Kept" }]);
  });

  it("lists every project and unlinked work group with all their challenges", async () => {
    const first = await publishChallenge("First");
    const second = await publishChallenge("Second");
    const planned = await publishChallenge("Planned too");
    const me = await person("Antía", "Paz");
    const repoA = await activeRepo("Alpha", [me], [first]);
    const repoB = await activeRepo("Beta", [me], [second]);
    const { rows } = await pool.query(
      `INSERT INTO repos (name,created_by,submission_status) VALUES ('Side quest',$1,'draft') RETURNING id`,
      [me],
    );
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status, responded_at) VALUES ($1, $2, 'active', now())`,
      [rows[0].id, me],
    );
    await pool.query(`INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2)`, [
      rows[0].id,
      planned,
    ]);
    await putProfile(me, VISIBLE);
    await save(me);
    const entry = (await card(me)).json();
    expect(entry.projects).toEqual([
      { kind: "project", id: repoA, name: "Alpha" },
      { kind: "project", id: repoB, name: "Beta" },
      { kind: "project", id: Number(rows[0].id), name: "Side quest" },
    ]);
    expect(entry.project).toEqual({ kind: "project", id: repoA, name: "Alpha" });
    expect(entry.challenges).toEqual([
      { id: first, name: "First" },
      { id: planned, name: "Planned too" },
      { id: second, name: "Second" },
    ]);
  });

  it("shows an unlinked planned work group", async () => {
    const challenge = await publishChallenge("Planned");
    const me = await person("Lúa", "Souto");
    const { rows } = await pool.query(
      `INSERT INTO repos (name,created_by,submission_status) VALUES ('Planners',$1,'draft') RETURNING id`,
      [me],
    );
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status, responded_at) VALUES ($1, $2, 'active', now())`,
      [rows[0].id, me],
    );
    await pool.query(`INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2)`, [
      rows[0].id,
      challenge,
    ]);
    await putProfile(me, VISIBLE);
    await save(me);
    const entry = (await card(me)).json();
    expect(entry.projects).toEqual([{ kind: "project", id: Number(rows[0].id), name: "Planners" }]);
    expect(entry.challenges).toEqual([{ id: challenge, name: "Planned" }]);

    await putProfile(me, { ...VISIBLE, showProject: false });
    const withoutProject = (await card(me)).json();
    expect(withoutProject.projects).toEqual([]);
    expect(withoutProject.project).toBeNull();
    expect(withoutProject.challenges).toEqual([]);
  });

  it("never exposes hidden, test, removal-pending or non-attendee profiles, even when saved", async () => {
    const hidden = await person("Hidden", "One");
    await putProfile(hidden, { ...VISIBLE, directoryVisible: false });
    const noRow = await person("No", "Row");
    const testAccount = await person("Test", "Account");
    await putProfile(testAccount, VISIBLE);
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [testAccount]);
    const pending = await person("Pending", "Removal");
    await putProfile(pending, VISIBLE);
    await pool.query(
      `UPDATE users SET account_state = 'removal_pending', removal_started_at = now() WHERE id = $1`,
      [pending],
    );
    const revoked = await person("Revoked", "Access");
    await putProfile(revoked, VISIBLE);
    await pool.query(`DELETE FROM user_roles WHERE user_id = $1`, [revoked]);

    for (const id of [hidden, noRow, testAccount, revoked]) await save(id);
    for (const id of [hidden, noRow, testAccount, pending, revoked]) {
      expect((await card(id)).statusCode).toBe(404);
    }
  });

  it("has no listing, and reads only people the caller saved, with event access", async () => {
    const me = await person("Ana", "Pérez");
    await putProfile(me, VISIBLE);
    // The browsable directory is retired (#935): people are added only by scanning.
    expect((await app.inject({ url: "/api/directory", headers: asUser(reader) })).statusCode).toBe(
      404,
    );
    expect((await card(me)).statusCode).toBe(404);
    await save(me);
    expect((await card(me)).statusCode).toBe(200);

    // Admins and user staff hold no browsing shortcut either.
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    await admitParticipant(admin);
    expect((await card(me, admin)).statusCode).toBe(404);

    const noAccess = await createUser();
    const role = await createRole([], { eventAccess: false });
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [noAccess, role]);
    await save(me, noAccess);
    expect((await card(me, noAccess)).statusCode).toBe(403);
  });
});

describe("moderation and removal (#934)", () => {
  it("hides a profile and clears its text, audited, only with users:write", async () => {
    const me = await person("Ana", "Pérez");
    await putProfile(me, { ...VISIBLE, headline: "Rude", locationNote: "Somewhere" });
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const moderate = (as: number, key: string) =>
      app.inject({
        method: "DELETE",
        url: `/api/users/${me}/public-profile`,
        headers: { ...asUser(as), "idempotency-key": key },
        payload: { reason: "Offensive headline" },
      });

    expect((await moderate(reader, "m-1")).statusCode).toBe(403);
    expect((await moderate(staff, "m-2")).statusCode).toBe(204);
    expect((await moderate(staff, "m-2")).statusCode).toBe(204);
    const { rows } = await pool.query(
      `SELECT directory_visible, headline, location_note FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    expect(rows[0]).toEqual({ directory_visible: false, headline: null, location_note: null });
    const audits = await pool.query(
      `SELECT actor_id, reason FROM audit_log WHERE action = 'public_profile.moderated'`,
    );
    expect(audits.rows).toEqual([{ actor_id: staff, reason: "Offensive headline" }]);
    await save(me);
    expect((await card(me)).statusCode).toBe(404);

    const missing = await app.inject({
      method: "DELETE",
      url: `/api/users/${reader}/public-profile`,
      headers: { ...asUser(staff), "idempotency-key": "m-3" },
      payload: { reason: "x" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("refuses to moderate an account being removed with 409", async () => {
    const me = await person("Ana", "Pérez");
    await putProfile(me, { ...VISIBLE, headline: "Rude" });
    await pool.query(
      `UPDATE users SET account_state = 'removal_pending', removal_started_at = now() WHERE id = $1`,
      [me],
    );
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${me}/public-profile`,
      headers: { ...asUser(staff), "idempotency-key": "m-pending" },
      payload: { reason: "Offensive headline" },
    });
    expect(res.statusCode).toBe(409);
    const { rows } = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'public_profile.moderated'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("includes the public profile in the personal export bundle (H54)", async () => {
    const { buildExportBundle } = await import("../../src/modules/exports/bundle.js");
    const me = await person("Ana", "Pérez");
    expect((await buildExportBundle(me)).publicProfile).toBeNull();
    await putProfile(me, { ...VISIBLE, headline: "Exported" });
    expect((await buildExportBundle(me)).publicProfile).toMatchObject({
      directory_visible: true,
      headline: "Exported",
      consented_at: expect.any(Date),
    });
  });

  it("rolls back the profile write when the audit insert fails", async () => {
    const me = await person("Ana", "Pérez");
    await pool.query(
      `CREATE OR REPLACE FUNCTION pg_temp_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_audit()`,
    );
    try {
      expect((await putProfile(me, VISIBLE)).statusCode).toBe(500);
    } finally {
      await pool.query(`DROP TRIGGER fail_audit ON audit_log`);
      await pool.query(`DROP FUNCTION pg_temp_fail_audit()`);
    }
    const { rows } = await pool.query(`SELECT 1 FROM user_public_profiles WHERE user_id = $1`, [
      me,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("removes the profile when the account is anonymized (H54)", async () => {
    const admin = await createUserWithCapabilities(["*"]);
    const me = await person("Ana", "Pérez");
    await putProfile(me, VISIBLE);
    // Operational history forces the anonymize path rather than a plain delete.
    await pool.query(`UPDATE users SET badge_id = 'B-DIR-ANON' WHERE id = $1`, [me]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-DIR-ANON', $2)`,
      [me, admin],
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(admin),
      payload: { subjectUserId: me, type: "deletion" },
    });
    expect(created.statusCode).toBe(201);
    const { processDataSubjectRequest } = await import("../../src/modules/exports/worker.js");
    await processDataSubjectRequest(created.json().id);
    const { rows } = await pool.query(`SELECT 1 FROM user_public_profiles WHERE user_id = $1`, [
      me,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("rejects direct profile writes for an account being removed (H54 trigger)", async () => {
    const me = await person("Ana", "Pérez");
    await pool.query(
      `UPDATE users SET account_state = 'removal_pending', removal_started_at = now() WHERE id = $1`,
      [me],
    );
    await expect(
      pool.query(`INSERT INTO user_public_profiles (user_id) VALUES ($1)`, [me]),
    ).rejects.toThrow(/closed or being removed/);
  });
});
