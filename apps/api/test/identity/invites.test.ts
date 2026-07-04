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

describe("H9/H10 invite acceptance", () => {
  it("staff acceptance creates a verified Better Auth account the person can sign in with", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, { email: "newstaff@example.com", kind: "staff" });

    const res = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token, language: "gl", foodIntolerances: [] },
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
      payload: { ...ACCEPT_BASE, token: invite.token },
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
        foodIntolerances: [],
        foodIntoleranceNotes: "no nuts",
      },
    });
    expect(ok.statusCode).toBe(201);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [ok.json().userId]);
    expect(rows[0].shirt_size).toBe("L");
    expect(rows[0].food_intolerance_notes).toBe("no nuts");
  });

  it("concurrent double-accept of the same token has exactly one winner", async () => {
    const a = await getApp();
    const actor = await inviter();
    const invite = await createInvite(a, actor, { email: "race@example.com", kind: "staff" });

    const [r1, r2] = await Promise.all([
      a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: { ...ACCEPT_BASE, token: invite.token },
      }),
      a.inject({
        method: "POST",
        url: "/api/invites/accept",
        payload: { ...ACCEPT_BASE, name: "Rival", token: invite.token },
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
      payload: { ...ACCEPT_BASE, token: invite.token },
    });
    expect(first.statusCode).toBe(201);

    const reuse = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: invite.token },
    });
    expect(reuse.statusCode).toBe(409);

    const unknown = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: "no-such-token" },
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
      payload: { ...ACCEPT_BASE, token: expired.token },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.details.expired).toBe(true);
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
      payload: { ...ACCEPT_BASE, token: original.token },
    });
    expect(old.statusCode).toBe(409);

    // new one works and still links the enterprise
    const accept = await a.inject({
      method: "POST",
      url: "/api/invites/accept",
      payload: { ...ACCEPT_BASE, token: fresh.token },
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
      payload: { ...ACCEPT_BASE, token: invite.token },
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
      payload: { ...ACCEPT_BASE, token: invite.token, shirtSize: "S" },
    });
    const after = await a.inject({
      method: "GET",
      url: `/api/invites/lookup?token=${invite.token}`,
    });
    expect(after.statusCode).toBe(404);
  });
});
