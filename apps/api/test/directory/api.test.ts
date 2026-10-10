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

/** #934: opt-in people directory and the owner's public profile. */

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
  reader = await createUserWithCapabilities([CAPABILITIES.DIRECTORY_READ]);
});
afterAll(async () => {
  await app.close();
});

async function person(name: string, surname: string, email = `${crypto.randomUUID()}@dir.test`) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, surname, image, email_verified, dni, badge_id)
     VALUES ($1, $2, $3, 'https://img.test/a.png', true, $4, $5) RETURNING id`,
    [email, name, surname, `DNI-${crypto.randomUUID()}`, `B-${crypto.randomUUID()}`],
  );
  const id = rows[0].id as number;
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

async function directory(query = "", as = reader) {
  return app.inject({ method: "GET", url: `/api/directory${query}`, headers: asUser(as) });
}

async function publishChallenge(title: string) {
  const id = await createChallenge(title, []);
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
      project: { kind: "project", id: repoId, name: "Unsaved" },
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

describe("directory reads (#934)", () => {
  it("lists opted-in people with project and published challenges, without private fields", async () => {
    const challenge = await publishChallenge("Green AI");
    const hidden = await createChallenge("Draft challenge", []);
    const jose = await person("José", "Álvarez");
    const teammate = await person("Hidden", "Mate");
    await activeRepo("Neural Beans", [jose, teammate], [challenge, hidden]);
    await putProfile(jose, { ...VISIBLE, showPhoto: true, locationNote: "Planta 1, mesa 12" });

    const res = await directory();
    expect(res.statusCode).toBe(200);
    expect(res.json().nextCursor).toBeNull();
    expect(res.json().items).toEqual([
      {
        userId: jose,
        displayName: "José Á.",
        photoUrl: "https://img.test/a.png",
        headline: null,
        locationNote: "Planta 1, mesa 12",
        project: { kind: "project", id: expect.any(Number), name: "Neural Beans" },
        challenges: [{ id: challenge, name: "Green AI" }],
      },
    ]);
    const body = res.body;
    for (const forbidden of ["email", "dni", "badge", "intoleran", "Mate", "@dir.test", "DNI-"]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("ignores cancelled and disqualified queue entries in challenges and the filter", async () => {
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
    expect((await directory()).json().items[0].challenges).toEqual([{ id: kept, name: "Kept" }]);
    expect((await directory(`?challengeId=${kept}`)).json().items).toHaveLength(1);
    for (const id of [cancelled, disqualified]) {
      expect((await directory(`?challengeId=${id}`)).json().items).toEqual([]);
    }
  });

  it("falls back to an unlinked planned work group", async () => {
    const challenge = await publishChallenge("Planned");
    const me = await person("Lúa", "Souto");
    const { rows } = await pool.query(
      `INSERT INTO planned_work_groups (name, created_by) VALUES ('Planners', $1) RETURNING id`,
      [me],
    );
    await pool.query(
      `INSERT INTO planned_work_group_members (group_id, user_id, status, responded_at) VALUES ($1, $2, 'active', now())`,
      [rows[0].id, me],
    );
    await pool.query(
      `INSERT INTO planned_work_group_challenges (group_id, challenge_id) VALUES ($1, $2)`,
      [rows[0].id, challenge],
    );
    await putProfile(me, VISIBLE);
    const [entry] = (await directory()).json().items;
    expect(entry.project).toEqual({ kind: "workGroup", id: Number(rows[0].id), name: "Planners" });
    expect(entry.challenges).toEqual([{ id: challenge, name: "Planned" }]);

    await putProfile(me, { ...VISIBLE, showProject: false });
    const [withoutProject] = (await directory()).json().items;
    expect(withoutProject.project).toBeNull();
    expect(withoutProject.challenges).toEqual([]);
  });

  it("searches ignoring accents, filters by challenge and pages stably", async () => {
    const challenge = await publishChallenge("Filter");
    const jose = await person("José", "Martínez");
    const people = [jose];
    for (const name of ["Bea", "Carla", "Dani", "Eva"]) people.push(await person(name, "Test"));
    await activeRepo("Filtered", [people[2] as number], [challenge]);
    for (const id of people) await putProfile(id, VISIBLE);

    const search = await directory("?q=jose");
    expect(search.json().items.map((i: { userId: number }) => i.userId)).toEqual([jose]);
    expect((await directory("?q=%25")).json().items).toEqual([]);

    const filtered = await directory(`?challengeId=${challenge}`);
    expect(filtered.json().items.map((i: { displayName: string }) => i.displayName)).toEqual([
      "Carla T.",
    ]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await directory(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(page.statusCode).toBe(200);
      seen.push(...page.json().items.map((i: { displayName: string }) => i.displayName));
      cursor = page.json().nextCursor;
    } while (cursor);
    expect(seen).toEqual(["Bea T.", "Carla T.", "Dani T.", "Eva T.", "José M."]);
    expect((await directory("?cursor=garbage")).statusCode).toBe(400);
    expect((await directory("?limit=51")).statusCode).toBe(400);
  });

  it("never exposes hidden, test, removal-pending or non-attendee profiles", async () => {
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

    expect((await directory()).json().items).toEqual([]);
    for (const id of [hidden, noRow, testAccount, pending, revoked]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/directory/${id}`,
        headers: asUser(reader),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("requires directory:read and event access to read", async () => {
    const me = await person("Ana", "Pérez");
    await putProfile(me, VISIBLE);
    const ok = await app.inject({
      method: "GET",
      url: `/api/directory/${me}`,
      headers: asUser(reader),
    });
    expect(ok.statusCode).toBe(200);

    // A participant without the capability (Sponsor/Judging Team by default).
    expect((await directory("", me)).statusCode).toBe(403);
    const noAccess = await createUser();
    const role = await createRole([CAPABILITIES.DIRECTORY_READ], { eventAccess: false });
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [noAccess, role]);
    expect((await directory("", noAccess)).statusCode).toBe(403);
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
    expect((await directory()).json().items).toEqual([]);

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
