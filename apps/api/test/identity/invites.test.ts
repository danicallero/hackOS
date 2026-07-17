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

  it("lists fields correctly including enterpriseId and groupIds", async () => {
    const a = await getApp();
    const actor = await inviter();
    const entId = await createEnterprise("DetailCo");

    const created = await createInvite(a, actor, {
      email: "detail@example.com",
      kind: "sponsor",
      enterpriseId: entId,
      groupIds: [],
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
    expect(invite.groupIds).toEqual([]);
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
    expect(look.json()).toEqual({ email: "peek@example.com", kind: "participant", expired: false });

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
});
