import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** H9/H10: invitation flow — create, regenerate, accept (staff/sponsor/participant). */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
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

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

async function inviter(): Promise<number> {
  return createUserWithCapabilities([CAPABILITIES.INVITES_MANAGE]);
}

async function createEnterprise(name = "ACME"): Promise<number> {
  const { pool } = await import("../../src/db/pool.js");
  const { rows } = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    name,
  ]);
  return rows[0].id;
}

async function createInvite(
  a: App,
  actor: number,
  payload: Record<string, unknown>,
): Promise<{ id: number; token: string }> {
  const res = await a.inject({
    method: "POST",
    url: "/api/invites",
    headers: asUser(actor),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function createEnterpriseInviteLink(
  a: App,
  actor: number,
  payload: Record<string, unknown>,
): Promise<{ id: number; token: string }> {
  const res = await a.inject({
    method: "POST",
    url: "/api/invites/enterprise-links",
    headers: asUser(actor),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function createUserInviteLink(
  a: App,
  actor: number,
  payload: Record<string, unknown>,
): Promise<{ id: number; token: string; url: string }> {
  const res = await a.inject({
    method: "POST",
    url: "/api/invites/user-links",
    headers: asUser(actor),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const ACCEPT_BASE = {
  name: "Marie",
  surname: "Curie",
  password: "polonium-1898!",
};

describe("H10 invite creation", () => {
  it("requires INVITES_MANAGE", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const res = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(pleb),
      payload: { email: "x@example.com", kind: "staff" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates a staff invite: token row + outbox email + audit", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, { email: "staff@example.com", kind: "staff" });

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT * FROM email_verification_tokens WHERE id = $1`, [
      invite.id,
    ]);
    expect(rows[0].type).toBe("account_claim");
    expect(rows[0].kind).toBe("staff");
    expect(rows[0].used_at).toBeNull();

    const { rows: outbox } = await pool.query(
      `SELECT * FROM notification_outbox WHERE payload->>'template' = 'auth.invite'`,
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload.recipient).toBe("staff@example.com");
    expect(outbox[0].payload.vars.claimUrl).toContain(invite.token);

    const { rows: auditRows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'invite' AND action = 'create'`,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actor_id).toBe(actor);
  });

  it("sponsor invites need enterpriseId (and only sponsor invites may carry it)", async () => {
    const a = await getApp();
    const actor = await inviter();

    const missing = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(actor),
      payload: { email: "s@example.com", kind: "sponsor" },
    });
    expect(missing.statusCode).toBe(400);

    const wrongKind = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(actor),
      payload: { email: "s@example.com", kind: "staff", enterpriseId: 1 },
    });
    expect(wrongKind.statusCode).toBe(400);

    const ghostEnterprise = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(actor),
      payload: { email: "s@example.com", kind: "sponsor", enterpriseId: 999999 },
    });
    expect(ghostEnterprise.statusCode).toBe(404);

    const entId = await createEnterprise();
    const ok = await createInvite(a, actor, {
      email: "s@example.com",
      kind: "sponsor",
      enterpriseId: entId,
    });
    expect(ok.token).toBeTruthy();
  });

  it("409 when the email already has an account", async () => {
    const a = await getApp();
    const actor = await inviter();
    await createUser({ email: "already@example.com" });
    const res = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(actor),
      payload: { email: "already@example.com", kind: "staff" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects anonymous and non-wildcard escalation, but lets a wildcard holder delegate a wildcard group", async () => {
    const a = await getApp();
    const manager = await inviter();
    const wildcard = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const { createRole } = await import("../helpers.js");
    const groupId = await createRole([CAPABILITIES.ADMIN_ALL], { name: "invite-platform-admin" });

    const anonymous = await a.inject({
      method: "POST",
      url: "/api/invites",
      payload: { email: "anonymous@example.com", kind: "staff" },
    });
    expect(anonymous.statusCode).toBe(401);

    const missingGroup = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(manager),
      payload: { email: "missing-group@example.com", kind: "staff", roleIds: [999_999] },
    });
    expect(missingGroup.statusCode).toBe(404);

    const escalation = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(manager),
      payload: { email: "escalation@example.com", kind: "staff", roleIds: [groupId] },
    });
    expect(escalation.statusCode).toBe(403);

    const delegated = await createInvite(a, wildcard, {
      email: "delegated@example.com",
      kind: "staff",
      roleIds: [groupId],
    });
    const accepted = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: delegated.token },
    });
    expect(accepted.statusCode).toBe(201);
    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    expect(await userHasCapability(accepted.json().userId, CAPABILITIES.INVITES_MANAGE)).toBe(true);
  });

  it("refuses to pre-assign system:superadmin even to a wildcard-holding inviter (H8 CLI-only lockout)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const { createRole } = await import("../helpers.js");
    const wildcard = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const superadminRoleId = await createRole([CAPABILITIES.ADMIN_ALL], {
      name: "system:superadmin",
      isProtected: true,
    });
    await pool.query(`UPDATE roles SET position = 999999999 WHERE id = $1`, [superadminRoleId]);

    const res = await a.inject({
      method: "POST",
      url: "/api/invites",
      headers: asUser(wildcard),
      payload: {
        email: "sneaky-superadmin@example.com",
        kind: "staff",
        roleIds: [superadminRoleId],
      },
    });
    expect(res.statusCode).toBe(403);

    const linkRes = await a.inject({
      method: "POST",
      url: "/api/invites/user-links",
      headers: asUser(wildcard),
      payload: { kind: "staff", roleIds: [superadminRoleId] },
    });
    expect(linkRes.statusCode).toBe(403);
  });
});

describe("GET /api/invites — list active invites", () => {
  it("requires INVITES_MANAGE", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const res = await a.inject({
      method: "GET",
      url: "/api/invites",
      headers: asUser(pleb),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns only active (unused + not expired) invites", async () => {
    const a = await getApp();
    const actor = await inviter();
    const { pool } = await import("../../src/db/pool.js");

    // active staff invite
    await createInvite(a, actor, { email: "active@example.com", kind: "staff" });
    // expired invite
    const expired = await createInvite(a, actor, {
      email: "expired@example.com",
      kind: "participant",
    });
    await pool.query(
      `UPDATE email_verification_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [expired.id],
    );
    // used invite
    const used = await createInvite(a, actor, { email: "used@example.com", kind: "staff" });
    await pool.query(`UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`, [
      used.id,
    ]);
    // active sponsor invite
    const entId = await createEnterprise("ListCo");
    await createInvite(a, actor, {
      email: "sponsor@example.com",
      kind: "sponsor",
      enterpriseId: entId,
    });

    const res = await a.inject({
      method: "GET",
      url: "/api/invites",
      headers: asUser(actor),
    });
    expect(res.statusCode).toBe(200);
    const invites = res.json();
    expect(invites).toHaveLength(2);
    expect(invites.map((i: { email: string }) => i.email).sort()).toEqual([
      "active@example.com",
      "sponsor@example.com",
    ]);
  });

  it("lists fields correctly including enterpriseId and roleIds", async () => {
    const a = await getApp();
    const actor = await inviter();
    const entId = await createEnterprise("DetailCo");

    const created = await createInvite(a, actor, {
      email: "detail@example.com",
      kind: "sponsor",
      enterpriseId: entId,
      roleIds: [],
    });

    const res = await a.inject({
      method: "GET",
      url: "/api/invites",
      headers: asUser(actor),
    });
    expect(res.statusCode).toBe(200);
    const invites = res.json();
    expect(invites).toHaveLength(1);
    const invite = invites[0];
    expect(invite.id).toBe(created.id);
    expect(invite.email).toBe("detail@example.com");
    expect(invite.kind).toBe("sponsor");
    expect(invite.enterpriseId).toBe(entId);
    expect(invite.roleIds).toEqual([]);
    expect(invite.expiresAt).toBeDefined();
    expect(invite.createdAt).toBeDefined();
    expect(typeof invite.expiresAt).toBe("string");
    expect(typeof invite.createdAt).toBe("string");
  });

  it("returns empty array when no active invites exist", async () => {
    const a = await getApp();
    const actor = await inviter();
    const { pool } = await import("../../src/db/pool.js");

    // only expired
    const inv = await createInvite(a, actor, { email: "old@example.com", kind: "staff" });
    await pool.query(
      `UPDATE email_verification_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [inv.id],
    );

    const res = await a.inject({
      method: "GET",
      url: "/api/invites",
      headers: asUser(actor),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("H9/H10 invite acceptance", () => {
  it("staff acceptance creates a verified Better Auth account the person can sign in with", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, { email: "newstaff@example.com", kind: "staff" });

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        token: invite.token,
        language: "gl",
        foodIntolerances: [1],
        shirtSize: "M",
      },
    });
    expect(res.statusCode).toBe(201);
    const { userId } = res.json();

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    expect(rows[0].email).toBe("newstaff@example.com");
    expect(rows[0].name).toBe("Marie");
    expect(rows[0].surname).toBe("Curie");
    expect(rows[0].email_verified).toBe(true); // invite link proves the mailbox
    expect(rows[0].language).toBe("gl");

    // token consumed + stamped with the created account
    const { rows: tok } = await pool.query(
      `SELECT * FROM email_verification_tokens WHERE id = $1`,
      [invite.id],
    );
    expect(tok[0].used_at).not.toBeNull();
    expect(tok[0].user_id).toBe(userId);

    // no leftover "verify your email" queued for an already-proven mailbox
    const { rows: outbox } = await pool.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND payload->>'template' = 'auth.verify'`,
      [userId],
    );
    expect(outbox).toHaveLength(0);

    // and the credentials work (H1/H4 via Better Auth)
    const login = await a.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "newstaff@example.com", password: ACCEPT_BASE.password },
    });
    expect(login.statusCode).toBe(200);

    // audited
    const { rows: auditRows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'invite' AND action = 'accept' AND entity_id = $1`,
      [String(invite.id)],
    );
    expect(auditRows).toHaveLength(1);
  });

  it("sponsor acceptance links the account to its enterprise (H9)", async () => {
    const a = await getApp();
    const actor = await inviter();
    const entId = await createEnterprise("SponsorCo");
    const invite = await createInvite(a, actor, {
      email: "sponsor@example.com",
      kind: "sponsor",
      enterpriseId: entId,
    });

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, foodIntolerances: [1], shirtSize: "M" },
    });
    expect(res.statusCode).toBe(201);
    const { userId } = res.json();

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT * FROM sponsors WHERE user_id = $1 AND enterprise_id = $2`,
      [userId, entId],
    );
    expect(rows).toHaveLength(1);
  });

  it("participant acceptance requires shirt size and stores logistics data (H10)", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, {
      email: "late@example.com",
      kind: "participant",
    });

    const noShirt = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token },
    });
    expect(noShirt.statusCode).toBe(400);

    const ok = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        token: invite.token,
        shirtSize: "L",
        foodIntolerances: [1],
        foodIntoleranceNotes: "no nuts",
      },
    });
    expect(ok.statusCode).toBe(201);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [ok.json().userId]);
    expect(rows[0].shirt_size).toBe("L");
    expect(rows[0].food_intolerance_notes).toBe("no nuts");
  });

  it("staff can accept without a shirt size or any dietary data", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, {
      email: "nologistics@example.com",
      kind: "staff",
    });

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      // No shirtSize, no foodIntolerances — the invitee has neither.
      payload: { ...ACCEPT_BASE, token: invite.token },
    });
    expect(res.statusCode).toBe(201);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [res.json().userId]);
    expect(rows[0].shirt_size).toBeNull();
    expect(rows[0].food_intolerances).toEqual([]);
  });

  it("participant can accept with a shirt size but no dietary restrictions", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, {
      email: "nofood@example.com",
      kind: "participant",
    });

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, shirtSize: "M" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("concurrent double-accept of the same token has exactly one winner", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, { email: "race@example.com", kind: "staff" });

    const [r1, r2] = await Promise.all([
      a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: { ...ACCEPT_BASE, token: invite.token, foodIntolerances: [1], shirtSize: "M" },
      }),
      a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: {
          ...ACCEPT_BASE,
          name: "Rival",
          token: invite.token,
          foodIntolerances: [1],
          shirtSize: "M",
        },
      }),
    ]);
    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [
      "race@example.com",
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("used / expired / unknown tokens are explicit errors, and a token is single-use", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, { email: "once@example.com", kind: "staff" });

    const first = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, foodIntolerances: [1], shirtSize: "M" },
    });
    expect(first.statusCode).toBe(201);

    const reuse = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, foodIntolerances: [1], shirtSize: "M" },
    });
    expect(reuse.statusCode).toBe(409);

    const unknown = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: "no-such-token", foodIntolerances: [1], shirtSize: "M" },
    });
    expect(unknown.statusCode).toBe(404);

    const { pool } = await import("../../src/db/pool.js");
    const expired = await createInvite(a, actor, { email: "slow@example.com", kind: "staff" });
    await pool.query(
      `UPDATE email_verification_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [expired.id],
    );
    const late = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: expired.token, foodIntolerances: [1], shirtSize: "M" },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.details.expired).toBe(true);
  });
});

describe("H10 event-configurable shirt/dietary requirements for invited sponsors/staff", () => {
  async function setInviteRequirements(a: App, overrides: Record<string, boolean>): Promise<void> {
    const manager = await createUserWithCapabilities([CAPABILITIES.INVITES_MANAGE]);
    const res = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: overrides,
    });
    expect(res.statusCode).toBe(200);
  }

  it("off by default: lookup reports no requirement, accept succeeds without a shirt size", async () => {
    const a = await getApp();
    const actor = await inviter();
    const entId = await createEnterprise("DefaultCo");
    const invite = await createInvite(a, actor, {
      email: "sponsor-default@example.com",
      kind: "sponsor",
      enterpriseId: entId,
    });

    const look = await a.inject({
      method: "GET",
      url: `/api/invites/lookup?token=${invite.token}`,
    });
    expect(look.json().requireShirtSize).toBe(false);
    expect(look.json().requireDietary).toBe(false);

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token },
    });
    expect(res.statusCode).toBe(201);
  });

  it("requireSponsorShirtSize blocks a sponsor claim without a shirt size once enabled", async () => {
    const a = await getApp();
    await setInviteRequirements(a, { requireSponsorShirtSize: true });
    const actor = await inviter();
    const entId = await createEnterprise("ReqCo");
    const invite = await createInvite(a, actor, {
      email: "sponsor-req@example.com",
      kind: "sponsor",
      enterpriseId: entId,
    });

    const look = await a.inject({
      method: "GET",
      url: `/api/invites/lookup?token=${invite.token}`,
    });
    expect(look.json().requireShirtSize).toBe(true);

    const noShirt = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token },
    });
    expect(noShirt.statusCode).toBe(400);
    expect(noShirt.json().error.details.field).toBe("shirtSize");

    const ok = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, shirtSize: "M" },
    });
    expect(ok.statusCode).toBe(201);
  });

  it("requireStaffShirtSize blocks a staff claim without a shirt size once enabled, independent of sponsors", async () => {
    const a = await getApp();
    await setInviteRequirements(a, { requireStaffShirtSize: true });
    const actor = await inviter();
    const entId = await createEnterprise("UnaffectedCo");

    const sponsorInvite = await createInvite(a, actor, {
      email: "sponsor-unaffected@example.com",
      kind: "sponsor",
      enterpriseId: entId,
    });
    const sponsorRes = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: sponsorInvite.token },
    });
    expect(sponsorRes.statusCode).toBe(201);

    const staffInvite = await createInvite(a, actor, {
      email: "staff-req@example.com",
      kind: "staff",
    });
    const noShirt = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: staffInvite.token },
    });
    expect(noShirt.statusCode).toBe(400);
    expect(noShirt.json().error.details.field).toBe("shirtSize");
  });

  it("requireSponsorDietary only affects lookup visibility, never blocks acceptance", async () => {
    const a = await getApp();
    await setInviteRequirements(a, { requireSponsorDietary: true });
    const actor = await inviter();
    const entId = await createEnterprise("DietCo");
    const invite = await createInvite(a, actor, {
      email: "sponsor-diet@example.com",
      kind: "sponsor",
      enterpriseId: entId,
    });

    const look = await a.inject({
      method: "GET",
      url: `/api/invites/lookup?token=${invite.token}`,
    });
    expect(look.json().requireDietary).toBe(true);

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      // No foodIntolerances/foodIntoleranceNotes at all — dietary is never a hard block.
      payload: { ...ACCEPT_BASE, token: invite.token },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("H10 late participant reaches a closed application form", () => {
  it("an invited participant can still save a draft and submit once the window has closed", async () => {
    const a = await getApp();
    const actor = await inviter();

    // The public form closed BEFORE the invite is even accepted — this is
    // exactly H10's "entra fuera de plazo con la inscripción ya cerrada".
    const { createApplication } = await import("../applications/fixtures.js");
    const past = new Date(Date.now() - 3600_000).toISOString();
    const appId = await createApplication({ type: "participant", open_at: past, close_at: past });

    const invite = await createInvite(a, actor, {
      email: "late@example.com",
      kind: "participant",
    });
    const accept = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        token: invite.token,
        foodIntolerances: [],
        shirtSize: "M",
      },
    });
    expect(accept.statusCode).toBe(201);
    const { userId } = accept.json();

    // A regular (non-invited) applicant is blocked from a brand-new draft on
    // a closed form (H12) — the late participant is the deliberate exception.
    const draft = await a.inject({
      method: "PUT",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
      payload: { responses: { motivation: "arrived late but ready" } },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().status).toBe("draft");

    // shirt_size is a top-level submit field (not part of `responses`) that
    // the real form always resends from the user's profile (set at invite
    // accept above) — the invited-participant bypass only waives the
    // separate up-front "shirt size is required" pre-check, not this.
    const submit = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(userId),
      payload: {
        responses: { motivation: "arrived late but ready" },
        shirt_size: "M",
      },
    });
    expect(submit.statusCode).toBe(200);
    // Late-invited participants skip review and land straight on a confirmed
    // spot (service.ts submitResponse) — their ticket is auto-issued.
    expect(submit.json().response.status).toBe("confirmed");
  });
});

describe("H9 invite regeneration", () => {
  it("issues a new token, kills the old one, keeps enterprise linkage", async () => {
    const a = await getApp();
    const actor = await inviter();
    const entId = await createEnterprise("RegenCo");
    const original = await createInvite(a, actor, {
      email: "regen@example.com",
      kind: "sponsor",
      enterpriseId: entId,
    });

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE email_verification_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [original.id],
    );

    const regen = await a.inject({
      method: "POST",
      url: `/api/invites/${original.id}/regenerate`,
      headers: asUser(actor),
    });
    expect(regen.statusCode).toBe(201);
    const fresh = regen.json();
    expect(fresh.token).not.toBe(original.token);
    expect(fresh.enterpriseId).toBe(entId);

    // old token unusable
    const old = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: original.token, foodIntolerances: [1], shirtSize: "M" },
    });
    expect(old.statusCode).toBe(409);

    // new one works and still links the enterprise
    const accept = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: fresh.token, foodIntolerances: [1], shirtSize: "M" },
    });
    expect(accept.statusCode).toBe(201);
    const { rows } = await pool.query(`SELECT * FROM sponsors WHERE user_id = $1`, [
      accept.json().userId,
    ]);
    expect(rows[0].enterprise_id).toBe(entId);
    const { rows: tickets } = await pool.query(`SELECT token FROM tickets WHERE user_id = $1`, [
      accept.json().userId,
    ]);
    expect(tickets).toHaveLength(1);
  });

  it("cannot regenerate an already-accepted invite", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, { email: "done@example.com", kind: "staff" });
    await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, foodIntolerances: [1], shirtSize: "M" },
    });
    const regen = await a.inject({
      method: "POST",
      url: `/api/invites/${invite.id}/regenerate`,
      headers: asUser(actor),
    });
    expect(regen.statusCode).toBe(409);
  });

  it("lookup exposes email/kind/expired for the accept screen without leaking used invites", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, { email: "peek@example.com", kind: "participant" });

    const look = await a.inject({
      method: "GET",
      url: `/api/invites/lookup?token=${invite.token}`,
    });
    expect(look.statusCode).toBe(200);
    expect(look.json()).toEqual({
      email: "peek@example.com",
      kind: "participant",
      enterpriseName: null,
      reusable: false,
      maxRedeems: null,
      redeemedCount: 0,
      remainingRedeems: null,
      expired: false,
      requireShirtSize: true,
      requireDietary: true,
    });

    await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, shirtSize: "S", foodIntolerances: [1] },
    });
    const after = await a.inject({
      method: "GET",
      url: `/api/invites/lookup?token=${invite.token}`,
    });
    expect(after.statusCode).toBe(404);
  });

  it("creates, tracks, limits, and withdraws reusable enterprise links", async () => {
    const a = await getApp();
    const actor = await inviter();
    const enterpriseId = await createEnterprise("ReusableCo");
    const link = await createEnterpriseInviteLink(a, actor, {
      enterpriseId,
      maxRedeems: 2,
      expiresInMinutes: 1,
    });

    const { pool } = await import("../../src/db/pool.js");
    const { rows: stored } = await pool.query(
      `SELECT max_redeems, redeemed_count, expires_at, revoked_at
         FROM enterprise_invite_links WHERE id = $1`,
      [link.id],
    );
    expect(stored[0].max_redeems).toBe(2);
    expect(stored[0].redeemed_count).toBe(0);
    expect(stored[0].expires_at).toBeTruthy();
    expect(stored[0].revoked_at).toBeNull();

    const lookup = await a.inject({
      method: "GET",
      url: `/api/invites/lookup?token=${link.token}`,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({
      email: null,
      kind: "sponsor",
      enterpriseName: "ReusableCo",
      reusable: true,
      maxRedeems: 2,
      redeemedCount: 0,
      remainingRedeems: 2,
      expired: false,
    });

    const missingEmail = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: link.token },
    });
    expect(missingEmail.statusCode).toBe(400);

    const first = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: link.token, email: "first@reusable.test" },
    });
    expect(first.statusCode).toBe(201);
    const second = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        name: "Second",
        token: link.token,
        email: "second@reusable.test",
      },
    });
    expect(second.statusCode).toBe(201);

    const exhausted = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        name: "Third",
        token: link.token,
        email: "third@reusable.test",
      },
    });
    expect(exhausted.statusCode).toBe(409);

    const list = await a.inject({
      method: "GET",
      url: `/api/invites/enterprise-links?enterpriseId=${enterpriseId}`,
      headers: asUser(actor),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).toMatchObject({
      id: link.id,
      enterpriseName: "ReusableCo",
      redeemedCount: 2,
      remainingRedeems: 0,
      status: "exhausted",
    });
    expect(list.json()[0].redemptions).toHaveLength(2);

    const { rows: members } = await pool.query(
      `SELECT u.email FROM sponsors s JOIN users u ON u.id = s.user_id
        WHERE s.enterprise_id = $1 ORDER BY u.email`,
      [enterpriseId],
    );
    expect(members.map((row: { email: string }) => row.email)).toEqual([
      "first@reusable.test",
      "second@reusable.test",
    ]);

    const withdrawn = await a.inject({
      method: "POST",
      url: `/api/invites/enterprise-links/${link.id}/withdraw`,
      headers: asUser(actor),
    });
    expect(withdrawn.statusCode).toBe(200);
    const afterWithdraw = await a.inject({
      method: "GET",
      url: `/api/invites/enterprise-links?enterpriseId=${enterpriseId}`,
      headers: asUser(actor),
    });
    expect(afterWithdraw.json()[0].status).toBe("withdrawn");
  });

  it("serializes reusable link redemptions so a one-redeem limit has one winner", async () => {
    const a = await getApp();
    const actor = await inviter();
    const enterpriseId = await createEnterprise("RaceCo");
    const link = await createEnterpriseInviteLink(a, actor, {
      enterpriseId,
      maxRedeems: 1,
      expiresInMinutes: null,
    });

    const [first, second] = await Promise.all([
      a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: { ...ACCEPT_BASE, token: link.token, email: "race-one@reusable.test" },
      }),
      a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: {
          ...ACCEPT_BASE,
          name: "Rival",
          token: link.token,
          email: "race-two@reusable.test",
        },
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
  });

  it("fails closed if an ordinary deferred role later gains wildcard access", async () => {
    const a = await getApp();
    const manager = await inviter();
    const wildcard = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const { pool } = await import("../../src/db/pool.js");
    const { createRole } = await import("../helpers.js");
    const role = await createRole([]);
    const stale = await createInvite(a, manager, {
      email: "stale-wildcard@example.com",
      kind: "staff",
      roleIds: [role],
    });

    // The role's own capabilities change after issuance, not the invitation
    // itself. Its default provenance must now fail closed.
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, 'allow')`,
      [role, CAPABILITIES.ADMIN_ALL],
    );
    for (const action of [
      { url: `/api/invites/${stale.id}/regenerate` },
      { url: `/api/invites/${stale.id}/renew` },
      { url: `/api/invites/${stale.id}/resend` },
    ]) {
      const res = await a.inject({
        method: "POST",
        url: action.url,
        headers: asUser(manager),
      });
      expect(res.statusCode).toBe(403);
    }

    const rejected = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: stale.token },
    });
    expect(rejected.statusCode).toBe(403);
    expect(
      (await pool.query(`SELECT id FROM users WHERE email = 'stale-wildcard@example.com'`)).rows,
    ).toHaveLength(0);

    const authorized = await createInvite(a, wildcard, {
      email: "authorized-wildcard@example.com",
      kind: "staff",
      roleIds: [role],
    });
    const accepted = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: authorized.token },
    });
    expect(accepted.statusCode).toBe(201);
    const { rows } = await pool.query(
      `SELECT wildcard_authorized FROM email_verification_tokens WHERE id = $1`,
      [authorized.id],
    );
    expect(rows[0].wildcard_authorized).toBe(true);
  });

  it("lets a wildcard holder reauthorize existing stale invites through every renewal path", async () => {
    const a = await getApp();
    const manager = await inviter();
    const wildcard = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const { pool } = await import("../../src/db/pool.js");
    const { createRole } = await import("../helpers.js");
    const role = await createRole([]);

    const stale = await Promise.all(
      ["regenerate", "renew", "resend"].map(async (operation) => ({
        operation,
        invite: await createInvite(a, manager, {
          email: `reauthorize-${operation}@example.com`,
          kind: "staff",
          roleIds: [role],
        }),
      })),
    );
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, 'allow')`,
      [role, CAPABILITIES.ADMIN_ALL],
    );

    for (const { operation, invite } of stale) {
      const response = await a.inject({
        method: "POST",
        url: `/api/invites/${invite.id}/${operation}`,
        headers: asUser(wildcard),
      });
      expect(response.statusCode).toBe(operation === "regenerate" ? 201 : 200);
      const token = operation === "regenerate" ? (response.json().token as string) : invite.token;
      expect(token).toBeTruthy();
      const { rows } = await pool.query(
        `SELECT wildcard_authorized FROM email_verification_tokens WHERE token = $1`,
        [token],
      );
      expect(rows[0].wildcard_authorized).toBe(true);

      const accepted = await a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: { ...ACCEPT_BASE, token },
      });
      expect(accepted.statusCode).toBe(201);
    }
  });
});

describe("H10 reusable user invite links", () => {
  it("requires a capability-backed role for a staff link", async () => {
    const a = await getApp();
    const actor = await inviter();

    const roleOptions = await a.inject({
      method: "GET",
      url: "/api/roles",
      headers: asUser(actor),
    });
    expect(roleOptions.statusCode).toBe(200);

    const missingGroups = await a.inject({
      method: "POST",
      url: "/api/invites/user-links",
      headers: asUser(actor),
      payload: { kind: "staff" },
    });
    expect(missingGroups.statusCode).toBe(400);

    const { createRole } = await import("../helpers.js");
    const emptyGroup = await createRole([], { name: "empty-link-group" });
    const noCapabilities = await a.inject({
      method: "POST",
      url: "/api/invites/user-links",
      headers: asUser(actor),
      payload: { kind: "staff", roleIds: [emptyGroup] },
    });
    expect(noCapabilities.statusCode).toBe(400);
  });

  it("creates and redeems a reusable staff link with a role", async () => {
    const a = await getApp();
    const actor = await inviter();
    const { pool } = await import("../../src/db/pool.js");
    const { createRole } = await import("../helpers.js");
    const groupId = await createRole([CAPABILITIES.QUEUE_OPERATE], { name: "reusable-staff-role" });

    const link = await createUserInviteLink(a, actor, {
      kind: "staff",
      roleIds: [groupId],
      maxRedeems: 2,
      expiresInMinutes: null,
    });
    expect(link.url).toContain(link.token);

    const lookup = await a.inject({
      method: "GET",
      url: `/api/invites/lookup?token=${link.token}`,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({
      email: null,
      kind: "staff",
      enterpriseName: null,
      reusable: true,
      maxRedeems: 2,
      redeemedCount: 0,
      remainingRedeems: 2,
      expired: false,
    });

    const missingEmail = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: link.token },
    });
    expect(missingEmail.statusCode).toBe(400);

    const first = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: link.token, email: "link-staff-one@example.com" },
    });
    expect(first.statusCode).toBe(201);
    const second = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        name: "Second",
        token: link.token,
        email: "link-staff-two@example.com",
      },
    });
    expect(second.statusCode).toBe(201);

    const exhausted = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        name: "Third",
        token: link.token,
        email: "link-staff-three@example.com",
      },
    });
    expect(exhausted.statusCode).toBe(409);

    const { userHasCapability } = await import("../../src/lib/capabilities.js");
    expect(await userHasCapability(first.json().userId, CAPABILITIES.QUEUE_OPERATE)).toBe(true);
    const { rows: memberships } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [first.json().userId, groupId],
    );
    expect(memberships).toHaveLength(1);

    const { rows: users } = await pool.query(`SELECT email_verified FROM users WHERE id = $1`, [
      first.json().userId,
    ]);
    expect(users[0].email_verified).toBe(false);
    const { rows: redemptions } = await pool.query(
      `SELECT email FROM user_invite_link_redemptions WHERE link_id = $1 ORDER BY email`,
      [link.id],
    );
    expect(redemptions.map((row: { email: string }) => row.email)).toEqual([
      "link-staff-one@example.com",
      "link-staff-two@example.com",
    ]);
  });

  it("supports participant links and preserves withdrawn-link history", async () => {
    const a = await getApp();
    const actor = await inviter();
    const link = await createUserInviteLink(a, actor, {
      kind: "participant",
      maxRedeems: 1,
      expiresInMinutes: null,
    });

    const accepted = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        token: link.token,
        email: "link-participant@example.com",
        shirtSize: "M",
      },
    });
    expect(accepted.statusCode).toBe(201);

    const withdrawn = await a.inject({
      method: "POST",
      url: `/api/invites/user-links/${link.id}/withdraw`,
      headers: asUser(actor),
    });
    expect(withdrawn.statusCode).toBe(200);

    const list = await a.inject({
      method: "GET",
      url: "/api/invites/user-links",
      headers: asUser(actor),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).toMatchObject({
      id: link.id,
      kind: "participant",
      status: "withdrawn",
      redeemedCount: 1,
    });
    expect(list.json()[0].redemptions).toHaveLength(1);

    const afterWithdraw = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        token: link.token,
        email: "link-participant-two@example.com",
        shirtSize: "M",
      },
    });
    expect(afterWithdraw.statusCode).toBe(409);
  });

  it("serializes a one-redeem staff link so only one claimant wins", async () => {
    const a = await getApp();
    const actor = await inviter();
    const { createRole } = await import("../helpers.js");
    const groupId = await createRole([CAPABILITIES.ACTIVITY_SCAN], { name: "race-link-role" });
    const link = await createUserInviteLink(a, actor, {
      kind: "staff",
      roleIds: [groupId],
      maxRedeems: 1,
      expiresInMinutes: null,
    });

    const [first, second] = await Promise.all([
      a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: { ...ACCEPT_BASE, token: link.token, email: "race-link-one@example.com" },
      }),
      a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: {
          ...ACCEPT_BASE,
          name: "Rival",
          token: link.token,
          email: "race-link-two@example.com",
        },
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
  });
});

// H8/H9/H10: the web invite dialog no longer asks the admin to pick an
// "account type" up front — it derives `kind` from what's actually filled
// in (enterprise picked -> sponsor, closed-form bypass checked ->
// participant, otherwise staff) and always lets roles be pre-assigned
// regardless of kind. These tests exercise the resulting backend
// combinations directly against the unchanged /api/invites contract.
describe("H8/H9/H10 invite kind composes with pre-assigned roles", () => {
  it("sponsor invite still auto-links its enterprise and fires the role-grant rule, even with extra roles", async () => {
    const a = await getApp();
    const actor = await inviter();
    const { pool } = await import("../../src/db/pool.js");
    const { createRole } = await import("../helpers.js");
    const entId = await createEnterprise("SponsorCo Roles");
    const extraRole = await createRole([CAPABILITIES.QUEUE_OPERATE], {
      name: "sponsor-extra-role",
    });
    // truncateAll wipes the real 0801/0805 seed data (see helpers.ts), so
    // recreate the Sponsor role + its role_grant_rules row the way
    // roles.test.ts's "H8 sponsor auto-grant rule" describe block does.
    const sponsorRole = await createRole([], { name: "Sponsor" });
    await pool.query(
      `INSERT INTO role_grant_rules (role_id, trigger_event, action) VALUES ($1, 'sponsor.enterprise_linked', 'grant')`,
      [sponsorRole],
    );

    const invite = await createInvite(a, actor, {
      email: "sponsor-with-role@example.com",
      kind: "sponsor",
      enterpriseId: entId,
      roleIds: [extraRole],
    });

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, foodIntolerances: [], shirtSize: "M" },
    });
    expect(res.statusCode).toBe(201);
    const { userId } = res.json();

    // Auto-linked to the enterprise (H9/H43).
    const { rows: sponsorRows } = await pool.query(
      `SELECT 1 FROM sponsors WHERE user_id = $1 AND enterprise_id = $2`,
      [userId, entId],
    );
    expect(sponsorRows).toHaveLength(1);

    // The seeded Sponsor role's role_grant_rules entry fired (H8).
    const { rows: roleRows } = await pool.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [userId],
    );
    const roleNames = roleRows.map((row: { name: string }) => row.name);
    expect(roleNames).toContain("Sponsor");

    // The extra pre-assigned role also landed.
    const { rows: extraRows } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, extraRole],
    );
    expect(extraRows).toHaveLength(1);
  });

  it("participant invite with pre-assigned roles still bypasses the closed window AND grants the roles", async () => {
    const a = await getApp();
    const actor = await inviter();
    const { pool } = await import("../../src/db/pool.js");
    const { createRole } = await import("../helpers.js");
    const { createApplication } = await import("../applications/fixtures.js");
    const { isInvitedParticipant } = await import("../../src/modules/applications/service.js");
    const extraRole = await createRole([CAPABILITIES.QUEUE_OPERATE], {
      name: "participant-extra-role",
    });

    const invite = await createInvite(a, actor, {
      email: "participant-with-role@example.com",
      kind: "participant",
      roleIds: [extraRole],
    });

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, shirtSize: "M", foodIntolerances: [] },
    });
    expect(res.statusCode).toBe(201);
    const { userId } = res.json();

    // Closed-window bypass eligibility (H10) is unaffected by pre-assigned roles.
    expect(await isInvitedParticipant(pool, userId)).toBe(true);

    const past = new Date(Date.now() - 3600_000).toISOString();
    const closedId = await createApplication({ name: "Closed", open_at: past, close_at: past });
    const single = await a.inject({
      method: "GET",
      url: `/api/public/applications/${closedId}`,
      headers: asUser(userId),
    });
    expect(single.statusCode).toBe(200);

    // The pre-assigned role also landed.
    const { rows: extraRows } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, extraRole],
    );
    expect(extraRows).toHaveLength(1);
  });

  it("a bare staff-ish invite (no enterprise, no bypass) with pre-assigned roles grants those roles on accept", async () => {
    const a = await getApp();
    const actor = await inviter();
    const { pool } = await import("../../src/db/pool.js");
    const { createRole } = await import("../helpers.js");
    const role = await createRole([CAPABILITIES.QUEUE_OPERATE], { name: "plain-staff-role" });

    const invite = await createInvite(a, actor, {
      email: "plain-staff@example.com",
      kind: "staff",
      roleIds: [role],
    });

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token },
    });
    expect(res.statusCode).toBe(201);
    const { userId } = res.json();

    const { rows } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, role],
    );
    expect(rows).toHaveLength(1);
  });

  it("reusable sponsor and participant links also accept pre-assigned roles now (backend no longer restricts roles to staff links)", async () => {
    const a = await getApp();
    const actor = await inviter();
    const { pool } = await import("../../src/db/pool.js");
    const { createRole } = await import("../helpers.js");
    const entId = await createEnterprise("ReusableSponsorRoles");
    const sponsorExtraRole = await createRole([CAPABILITIES.QUEUE_OPERATE], {
      name: "reusable-sponsor-extra-role",
    });
    const participantExtraRole = await createRole([CAPABILITIES.QUEUE_OPERATE], {
      name: "reusable-participant-extra-role",
    });

    const sponsorLink = await createUserInviteLink(a, actor, {
      kind: "sponsor",
      enterpriseId: entId,
      roleIds: [sponsorExtraRole],
      maxRedeems: 1,
      expiresInMinutes: null,
    });
    const sponsorAccept = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        token: sponsorLink.token,
        email: "reusable-sponsor-role@example.com",
        foodIntolerances: [],
        shirtSize: "M",
      },
    });
    expect(sponsorAccept.statusCode).toBe(201);
    const { rows: sponsorRoleRows } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [sponsorAccept.json().userId, sponsorExtraRole],
    );
    expect(sponsorRoleRows).toHaveLength(1);

    const participantLink = await createUserInviteLink(a, actor, {
      kind: "participant",
      roleIds: [participantExtraRole],
      maxRedeems: 1,
      expiresInMinutes: null,
    });
    const participantAccept = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: {
        ...ACCEPT_BASE,
        token: participantLink.token,
        email: "reusable-participant-role@example.com",
        shirtSize: "M",
      },
    });
    expect(participantAccept.statusCode).toBe(201);
    const { rows: participantRoleRows } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [participantAccept.json().userId, participantExtraRole],
    );
    expect(participantRoleRows).toHaveLength(1);
  });
});

describe("#538 invite/token flow rate limits", () => {
  it("caps /api/invites/lookup at 30/min per IP", async () => {
    const a = await getApp();

    let last: Awaited<ReturnType<typeof a.inject>> | undefined;
    for (let i = 0; i < 31; i += 1) {
      last = await a.inject({ method: "GET", url: "/api/invites/lookup?token=nonexistent" });
    }
    expect(last?.statusCode).toBe(429);
    expect(Number(last?.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("caps /api/invites/accept at 20/hour per IP, independent of token validity", async () => {
    const a = await getApp();

    let last: Awaited<ReturnType<typeof a.inject>> | undefined;
    for (let i = 0; i < 21; i += 1) {
      last = await a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: { ...ACCEPT_BASE, token: `nonexistent-${i}` },
      });
    }
    expect(last?.statusCode).toBe(429);
    expect(Number(last?.headers["retry-after"])).toBeGreaterThan(0);
  });
});
