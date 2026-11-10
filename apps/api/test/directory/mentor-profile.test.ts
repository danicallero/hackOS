import { CAPABILITIES } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  createRole,
  createUser,
  createUserWithCapabilities,
  useTestApp,
} from "../helpers.js";
import { admitParticipant } from "../projects/fixtures.js";

/** Mentor/helper profile (onboarding contract §5): eligibility is only `helpdesk:offer`. */

let app: App;
let keySeq = 0;

const getApp = useTestApp();
beforeEach(async () => {
  app = await getApp();
});

/** A help desk knowledge topic the person lists as an area (the mentor's expertise). */
async function topic(userId: number, name: string) {
  await pool.query(`INSERT INTO helper_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
    userId,
  ]);
  const { rows } = await pool.query(
    `INSERT INTO help_topics (name, name_key) VALUES ($1, lower($1)) RETURNING id`,
    [name],
  );
  await pool.query(`INSERT INTO helper_topics (user_id, topic_id) VALUES ($1, $2)`, [
    userId,
    rows[0].id,
  ]);
  return rows[0].id as number;
}

function put(
  userId: number,
  body: unknown,
  path = "/api/me/mentor-profile",
  key = `m-${++keySeq}`,
) {
  return app.inject({
    method: "PUT",
    url: path,
    headers: { ...asUser(userId), "idempotency-key": key },
    payload: body as object,
  });
}
const get = (userId: number, path = "/api/me/mentor-profile") =>
  app.inject({ method: "GET", url: path, headers: asUser(userId) });

describe("mentor eligibility is the effective capability only", () => {
  it.each([
    ["a plain capability holder", [CAPABILITIES.HELPDESK_OFFER]],
    ["a wildcard holder", [CAPABILITIES.ADMIN_ALL]],
  ])("%s may edit and publish", async (_label, caps) => {
    const id = await createUserWithCapabilities(caps);
    const expertise = await topic(id, "Rust");
    expect((await get(id)).json()).toMatchObject({ eligible: true, published: false });
    const res = await put(id, { published: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      eligible: true,
      published: true,
      expertise: [{ id: expertise, label: "Rust" }],
    });
  });

  it("a participant holding the capability qualifies, with no networking opt-in", async () => {
    const id = await createUserWithCapabilities([CAPABILITIES.HELPDESK_OFFER]);
    await admitParticipant(id);
    const res = await put(id, { published: true });
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(`SELECT 1 FROM user_public_profiles WHERE user_id=$1`, [id]);
    expect(rows).toHaveLength(0);
  });

  it("without the capability the profile is ineligible and PUT answers 403 with the reason", async () => {
    const id = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    expect((await get(id)).json()).toMatchObject({ eligible: false, published: false });
    const res = await put(id, { published: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.code).toBe("mentor_profile_not_eligible");
  });

  it("keeps stored data when the capability is lost and restores it when regained", async () => {
    const id = await createUser();
    const roleId = await createRole([CAPABILITIES.HELPDESK_OFFER]);
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [id, roleId]);
    const expertise = await topic(id, "Design");
    await put(id, { published: true });
    await pool.query(`DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2`, [id, roleId]);
    expect((await get(id)).json()).toMatchObject({
      eligible: false,
      published: true,
      expertise: [{ id: expertise, label: "Design" }],
    });
    expect((await put(id, { published: false })).statusCode).toBe(403);
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [id, roleId]);
    expect((await get(id)).json()).toMatchObject({ eligible: true, published: true });
  });
});

describe("mentor profile writes", () => {
  it("replays an idempotent retry and writes nothing when unchanged", async () => {
    const id = await createUserWithCapabilities([CAPABILITIES.HELPDESK_OFFER]);
    const body = { published: true };
    const first = await put(id, body, "/api/me/mentor-profile", "same");
    const replay = await put(id, body, "/api/me/mentor-profile", "same");
    expect(replay.json()).toEqual(first.json());
    await put(id, body);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_type='mentor_profile'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("audits the changed field name only", async () => {
    const id = await createUserWithCapabilities([CAPABILITIES.HELPDESK_OFFER]);
    await topic(id, "SentinelExpertiseZZ");
    await put(id, { published: true });
    const { rows } = await pool.query(`SELECT * FROM audit_log WHERE entity_type='mentor_profile'`);
    expect(JSON.stringify(rows)).not.toContain("SentinelExpertiseZZ");
    expect(rows[0].changed_fields).toEqual(["published"]);
  });

  it("concurrent identical writes leave one consistent profile", async () => {
    const id = await createUserWithCapabilities([CAPABILITIES.HELPDESK_OFFER]);
    const results = await Promise.all([put(id, { published: true }), put(id, { published: true })]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await get(id)).json().published).toBe(true);
  });

  it("staff read and write need users capabilities and are audited as admin", async () => {
    const target = await createUserWithCapabilities([CAPABILITIES.HELPDESK_OFFER]);
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const writer = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const path = `/api/users/${target}/mentor-profile`;
    expect((await get(reader, path)).statusCode).toBe(200);
    expect((await put(reader, { published: true }, path)).statusCode).toBe(403);
    expect((await put(writer, { published: true }, path)).statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT source FROM audit_log WHERE entity_type='mentor_profile'`,
    );
    expect(rows[0].source).toBe("admin");
  });
});

describe("scanner view of a mentor", () => {
  async function reader(target: number) {
    const id = await createUser();
    await admitParticipant(id);
    await pool.query(`INSERT INTO diary_entries (owner_id, target_user_id) VALUES ($1, $2)`, [
      id,
      target,
    ]);
    return id;
  }
  const card = (id: number, target: number) =>
    app.inject({ method: "GET", url: `/api/directory/${target}`, headers: asUser(id) });

  async function mentor(name: string) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, surname, email_verified, dni, badge_id)
       VALUES ($1, $2, 'Hidden', true, $3, $4) RETURNING id`,
      [
        `${crypto.randomUUID()}@m.test`,
        name,
        `D-${crypto.randomUUID()}`,
        `B-${crypto.randomUUID()}`,
      ],
    );
    const id = rows[0].id as number;
    const roleId = await createRole([CAPABILITIES.HELPDESK_OFFER]);
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [id, roleId]);
    await admitParticipant(id);
    return { id, roleId };
  }

  it("a published mentor stays readable with the networking opt-in off, exposing only name and expertise", async () => {
    const { id } = await mentor("Mia");
    await topic(id, "Kubernetes");
    await put(id, { published: true });
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, directory_visible, bio, headline) VALUES ($1,false,'private bio','private headline')`,
      [id],
    );
    const res = await card(await reader(id), id);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mentor).toEqual({ expertise: ["Kubernetes"] });
    expect(body.displayName).toBe("Mia H.");
    expect(body).toMatchObject({
      bio: null,
      headline: null,
      photoUrl: null,
      cvUrl: null,
      socials: [],
    });
  });

  it("an unpublished mentor and a hidden person stay 404", async () => {
    const { id } = await mentor("Nia");
    await put(id, { published: false });
    expect((await card(await reader(id), id)).statusCode).toBe(404);
  });

  it("an opted-in profile carries mentor only while published and eligible", async () => {
    const { id, roleId } = await mentor("Ola");
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, directory_visible, consented_at) VALUES ($1,true,now())`,
      [id],
    );
    const viewer = await reader(id);
    expect((await card(viewer, id)).json().mentor).toBeNull();
    await topic(id, "Python");
    await put(id, { published: true });
    expect((await card(viewer, id)).json().mentor).toEqual({ expertise: ["Python"] });
    await pool.query(`DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2`, [id, roleId]);
    expect((await card(viewer, id)).json().mentor).toBeNull();
  });
});
