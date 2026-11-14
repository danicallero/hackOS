import "../applications/env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { createApplication, latestConfirmationToken } from "../applications/fixtures.js";
import {
  asUser,
  createRole,
  createUser,
  createUserWithCapabilities,
  ensureApplicationFormVersion,
  grantAttendeeRole,
  useTestApp,
} from "../helpers.js";

/**
 * Release-review scoping fixes (H8, H28): the global role catalogue is only
 * mutable from the current edition, application rows resolve only in the
 * viewed edition, invitations and profile locks are per edition, and
 * sponsor/judge/public-surface lookups ignore other editions' enterprises.
 */

const getApp = useTestApp();

async function createEdition(key: string) {
  await pool.query(`INSERT INTO editions (event_key, name, status) VALUES ($1, $1, 'active')`, [
    key,
  ]);
}

/** A user holding `capabilities` in the current edition AND in `e2`. */
async function staffInBoth(capabilities: string[]): Promise<number> {
  const userId = await createUser({ emailVerified: true });
  const roleId = await createRole(capabilities);
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
    userId,
    roleId,
  ]);
  return userId;
}

async function responseIn(appId: number, status = "review"): Promise<{ id: number; user: number }> {
  const user = await createUser({ emailVerified: true });
  const version = await ensureApplicationFormVersion(appId);
  const { rows } = await pool.query(
    `INSERT INTO application_responses (user_id, application_id, application_form_version_id, status, responses)
     VALUES ($1, $2, $3, $4, '{}'::jsonb) RETURNING id`,
    [user, appId, version, status],
  );
  return { id: rows[0].id, user };
}

describe("role catalogue mutations (bug 1)", () => {
  it("rejects catalogue mutations from a non-current edition, allows them in the current one", async () => {
    const a = await getApp();
    await createEdition("old");
    const roleId = await createRole([]);
    const wildcard = await createRole([CAPABILITIES.ADMIN_ALL]);
    const user = await createUser();
    // Wildcard held only in the past edition.
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'old')`,
      [user, wildcard],
    );
    const headers = { ...asUser(user), "x-edition": "old", "idempotency-key": crypto.randomUUID() };

    const grant = await a.inject({
      method: "PUT",
      url: `/api/roles/${roleId}/capabilities`,
      headers,
      payload: { capabilities: [{ capability: "*", state: "allow" }] },
    });
    expect(grant.statusCode).toBe(409);
    const create = await a.inject({
      method: "POST",
      url: "/api/roles",
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload: { name: "from-the-past", position: 1 },
    });
    expect(create.statusCode).toBe(409);
    const rule = await a.inject({
      method: "DELETE",
      url: "/api/role-grant-rules/1",
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    });
    expect(rule.statusCode).toBe(409);
    const { rows } = await pool.query(
      `SELECT 1 FROM role_capabilities WHERE role_id = $1 AND capability = '*'`,
      [roleId],
    );
    expect(rows).toHaveLength(0);

    // Same-edition happy path: a current-edition manager still creates roles.
    const manager = await createUserWithCapabilities([CAPABILITIES.PERMISSIONS_MANAGE]);
    const ok = await a.inject({
      method: "POST",
      url: "/api/roles",
      headers: { ...asUser(manager), "idempotency-key": crypto.randomUUID() },
      payload: { name: "current-role", position: 1 },
    });
    expect(ok.statusCode).toBe(201);
  });
});

describe("application by-id lookups (bug 2)", () => {
  it("404s rows of another edition and works inside their own edition", async () => {
    const a = await getApp();
    await createEdition("e2");
    const staff = await staffInBoth([
      CAPABILITIES.APPLICATIONS_MANAGE,
      CAPABILITIES.APPLICATIONS_DECIDE,
      CAPABILITIES.APPLICATIONS_REVIEW,
    ]);
    const appId = await createApplication({ name: "E2 form" });
    await pool.query("UPDATE applications SET event_key = 'e2' WHERE id = $1", [appId]);
    const response = await responseIn(appId);
    const h = (extra: Record<string, string> = {}) => ({
      ...asUser(staff),
      "idempotency-key": crypto.randomUUID(),
      ...extra,
    });

    for (const [method, url, payload] of [
      ["POST", `/api/responses/${response.id}/decide`, { decision: "accepted" }],
      ["GET", `/api/responses/${response.id}`, undefined],
      ["GET", `/api/applications/${appId}/responses`, undefined],
      ["GET", `/api/applications/${appId}/decision-pool`, undefined],
      ["POST", `/api/applications/${appId}/send-decisions`, {}],
      ["PATCH", `/api/applications/${appId}`, { name: "renamed" }],
      ["DELETE", `/api/applications/${appId}`, undefined],
    ] as const) {
      const res = await a.inject({ method, url, headers: h(), ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const stillThere = await pool.query("SELECT name FROM applications WHERE id = $1", [appId]);
    expect(stillThere.rows[0].name).toBe("E2 form");

    const decided = await a.inject({
      method: "POST",
      url: `/api/responses/${response.id}/decide`,
      headers: h({ "x-edition": "e2" }),
      payload: { decision: "accepted" },
    });
    expect(decided.statusCode).toBe(200);
    const renamed = await a.inject({
      method: "PATCH",
      url: `/api/applications/${appId}`,
      headers: h({ "x-edition": "e2" }),
      payload: { name: "renamed" },
    });
    expect(renamed.statusCode).toBe(200);
  });

  it("still confirms a spot from the email token without an edition header", async () => {
    const a = await getApp();
    await createEdition("e2");
    const staff = await staffInBoth([
      CAPABILITIES.APPLICATIONS_MANAGE,
      CAPABILITIES.APPLICATIONS_DECIDE,
    ]);
    const appId = await createApplication({ name: "E2 form" });
    await pool.query("UPDATE applications SET event_key = 'e2' WHERE id = $1", [appId]);
    const response = await responseIn(appId);
    const edition = { ...asUser(staff), "x-edition": "e2" };
    await a.inject({
      method: "POST",
      url: `/api/responses/${response.id}/decide`,
      headers: edition,
      payload: { decision: "accepted" },
    });
    const sent = await a.inject({
      method: "POST",
      url: `/api/responses/${response.id}/send-decision`,
      headers: edition,
    });
    expect(sent.statusCode).toBeLessThan(300);
    const token = await latestConfirmationToken(response.user);
    const confirmed = await a.inject({
      method: "POST",
      url: "/api/applications/confirm",
      headers: { "idempotency-key": crypto.randomUUID() },
      payload: { token },
    });
    expect(confirmed.statusCode).toBe(200);
  });
});

describe("invited participant (bug 3)", () => {
  it("counts an invitation only for the edition it was redeemed in", async () => {
    await createEdition("e2");
    const { isInvitedParticipant } = await import("../../src/modules/applications/service.js");
    const user = await createUser();
    await pool.query(
      `INSERT INTO email_verification_tokens (token, type, email, user_id, kind, expires_at, used_at)
       VALUES ('old-claim', 'account_claim', 'x@test.local', $1, 'participant',
               now() + interval '1 hour', now() - interval '400 days')`,
      [user],
    );
    // Redeemed long before e2 existed: not invited there, no review bypass.
    expect(await isInvitedParticipant(pool, user, "e2")).toBe(false);
    // An invite-sourced role in e2 attributes the invitation to e2.
    const role = await createRole([]);
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, event_key, source) VALUES ($1, $2, 'e2', 'invite')`,
      [user, role],
    );
    expect(await isInvitedParticipant(pool, user, "e2")).toBe(true);
    // A fresh roleless invite redeemed while e2 is open counts there.
    const other = await createUser();
    await pool.query(
      `INSERT INTO email_verification_tokens (token, type, email, user_id, kind, expires_at, used_at)
       VALUES ('new-claim', 'account_claim', 'y@test.local', $1, 'participant',
               now() + interval '1 hour', now() + interval '1 minute')`,
      [other],
    );
    expect(await isInvitedParticipant(pool, other, "e2")).toBe(true);
  });
});

describe("profile lock (bug 4)", () => {
  it("ignores accepted responses of another edition", async () => {
    const a = await getApp();
    await createEdition("e2");
    const user = await createUser();
    const appId = await createApplication({ name: "Other" });
    await pool.query("UPDATE applications SET event_key = 'e2' WHERE id = $1", [appId]);
    const version = await ensureApplicationFormVersion(appId);
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'confirmed', '{}'::jsonb)`,
      [user, appId, version],
    );
    const patch = (surname: string) =>
      a.inject({ method: "PATCH", url: "/api/me", headers: asUser(user), payload: { surname } });
    expect((await patch("Byron")).statusCode).toBe(200);

    // Accepted in the current edition: locked.
    const current = await createApplication({ name: "Now" });
    const currentVersion = await ensureApplicationFormVersion(current);
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'accepted', '{}'::jsonb)`,
      [user, current, currentVersion],
    );
    expect((await patch("Lovelace")).statusCode).toBe(409);
  });
});

describe("enterprise-backed lookups (bugs 5 and 6)", () => {
  it("scopes sponsor/judge flags and public-surface sharing to the current edition", async () => {
    await createEdition("e2");
    const { computeMembershipFlags } = await import("../../src/modules/identity/role.js");
    const { profilePublishedOnPublicSurface } = await import(
      "../../src/modules/directory/service.js"
    );
    const sponsorUser = await createUser();
    const judgeUser = await createUser();
    const mk = async (key: string | null) =>
      (
        await pool.query(
          `INSERT INTO enterprises (name, visibility${key ? ", event_key" : ""})
           VALUES ($1, 'visible'${key ? ", $2" : ""}) RETURNING id`,
          key ? [`ent-${key}`, key] : ["ent-now"],
        )
      ).rows[0].id as number;
    const past = await mk("e2");
    await pool.query("INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)", [
      past,
      sponsorUser,
    ]);
    await pool.query("INSERT INTO enterprise_judges (enterprise_id, user_id) VALUES ($1, $2)", [
      past,
      judgeUser,
    ]);
    expect(await computeMembershipFlags(pool, sponsorUser)).toEqual({
      isEnterpriseJudge: false,
      isSponsorRep: false,
    });
    expect((await computeMembershipFlags(pool, judgeUser)).isEnterpriseJudge).toBe(false);

    const now = await mk(null);
    await pool.query("INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)", [
      now,
      sponsorUser,
    ]);
    await pool.query("INSERT INTO enterprise_judges (enterprise_id, user_id) VALUES ($1, $2)", [
      now,
      judgeUser,
    ]);
    expect(await computeMembershipFlags(pool, sponsorUser)).toEqual({
      isEnterpriseJudge: true,
      isSponsorRep: true,
    });
    expect((await computeMembershipFlags(pool, judgeUser)).isEnterpriseJudge).toBe(true);

    // Public surface: a representative of only a past edition's enterprise is not shared.
    const rep = await createUser();
    await grantAttendeeRole(rep, "participant");
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, directory_visible, show_photo, consented_at)
       VALUES ($1, true, false, now())`,
      [rep],
    );
    await pool.query("INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)", [past, rep]);
    expect(await profilePublishedOnPublicSurface(pool, rep)).toBe(false);
    await pool.query("INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)", [now, rep]);
    expect(await profilePublishedOnPublicSurface(pool, rep)).toBe(true);
  });
});
