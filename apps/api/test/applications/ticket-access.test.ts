import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { createApplication } from "./fixtures.js";

/**
 * Losing event access (declining a confirmed spot, or staff revoking one)
 * must stop the ticket/wallet from being served — even though the `tickets`
 * row itself is never touched (plan/07 invariant 10: neither consumed nor
 * revoked). Any wallet pass already issued gets voided. Capability holders
 * (admin/staff) and sponsor reps are the exception: their event access does
 * not depend on application status at all, so declining/losing an
 * application spot never strips their ticket (H43).
 */

let app: App;
let decider: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  decider = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_DECIDE]);
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

async function createTicketPass(userId: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO wallet_passes (user_id, purpose, platform, serial_number, authentication_token)
     VALUES ($1, 'ticket', 'apple', $2, $3) RETURNING id`,
    [userId, `sn-${crypto.randomUUID()}`, `at-${crypto.randomUUID()}`],
  );
  return rows[0].id;
}

async function passStatus(id: number): Promise<string> {
  const { rows } = await pool.query(`SELECT status FROM wallet_passes WHERE id = $1`, [id]);
  return rows[0].status;
}

/** Submit, accept, send, and self-confirm a fresh response — issues a real ticket. */
async function toConfirmed(appId: number): Promise<{ userId: number; responseId: number }> {
  const a = await getApp();
  const userId = await createUser({ emailVerified: true });
  await a.inject({
    method: "PUT",
    url: `/api/applications/${appId}/response`,
    headers: asUser(userId),
    payload: { responses: { motivation: "yes" } },
  });
  await a.inject({
    method: "POST",
    url: `/api/applications/${appId}/response/submit`,
    headers: asUser(userId),
    payload: { food_intolerances: [], shirt_size: "M" },
  });
  const { rows } = await pool.query(
    `SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2`,
    [userId, appId],
  );
  const responseId = rows[0].id;
  await a.inject({
    method: "POST",
    url: `/api/responses/${responseId}/decide`,
    headers: asUser(decider),
    payload: { decision: "accepted" },
  });
  await a.inject({
    method: "POST",
    url: `/api/responses/${responseId}/send-decision`,
    headers: asUser(decider),
  });
  await a.inject({
    method: "POST",
    url: `/api/me/responses/${responseId}/confirm`,
    headers: asUser(userId),
  });
  return { userId, responseId };
}

describe("ticket/wallet exposure follows event access", () => {
  it("declining a confirmed spot voids the wallet pass and stops serving the ticket", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toConfirmed(appId);
    const passId = await createTicketPass(userId);

    const before = await a.inject({ method: "GET", url: "/api/me", headers: asUser(userId) });
    expect(before.json().hasEventAccess).toBe(true);

    const decline = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
      headers: asUser(userId),
    });
    expect(decline.statusCode).toBe(200);

    expect(await passStatus(passId)).toBe("voided");

    const after = await a.inject({ method: "GET", url: "/api/me", headers: asUser(userId) });
    expect(after.json().hasEventAccess).toBe(false);

    const ticket = await a.inject({
      method: "GET",
      url: "/api/me/ticket",
      headers: asUser(userId),
    });
    expect(ticket.json().ticketToken).toBeNull();

    // The underlying tickets row is never touched (plan/07 invariant 10).
    const { rows } = await pool.query(`SELECT 1 FROM tickets WHERE user_id = $1`, [userId]);
    expect(rows).toHaveLength(1);
  });

  it("staff revoking a confirmed spot voids the wallet pass the same way", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toConfirmed(appId);
    const passId = await createTicketPass(userId);

    const revoke = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/revoke-spot`,
      headers: asUser(decider),
    });
    expect(revoke.statusCode).toBe(200);

    expect(await passStatus(passId)).toBe("voided");
    const after = await a.inject({ method: "GET", url: "/api/me", headers: asUser(userId) });
    expect(after.json().hasEventAccess).toBe(false);
  });

  it("keeps access and the wallet pass active when another confirmed response remains", async () => {
    const a = await getApp();
    const appId1 = await createApplication({ name: "Track A" });
    const appId2 = await createApplication({ name: "Track B" });
    const { userId } = await toConfirmed(appId1);

    // Second application, same user, also confirmed.
    await a.inject({
      method: "PUT",
      url: `/api/applications/${appId2}/response`,
      headers: asUser(userId),
      payload: { responses: { motivation: "also yes" } },
    });
    await a.inject({
      method: "POST",
      url: `/api/applications/${appId2}/response/submit`,
      headers: asUser(userId),
      payload: { food_intolerances: [], shirt_size: "M" },
    });
    const { rows } = await pool.query(
      `SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2`,
      [userId, appId2],
    );
    const responseId2 = rows[0].id;
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId2}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId2}/send-decision`,
      headers: asUser(decider),
    });
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId2}/confirm`,
      headers: asUser(userId),
    });

    const passId = await createTicketPass(userId);

    // Decline the FIRST response only — the second stays confirmed.
    const { rows: firstRows } = await pool.query(
      `SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2`,
      [userId, appId1],
    );
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${firstRows[0].id}/decline`,
      headers: asUser(userId),
    });

    const after = await a.inject({ method: "GET", url: "/api/me", headers: asUser(userId) });
    expect(after.json().hasEventAccess).toBe(true);
    expect(await passStatus(passId)).toBe("active");
  });

  it("a manually-assigned attendee role grants event access without any application", async () => {
    const a = await getApp();
    const userId = await createUser({ emailVerified: true });
    const admin = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);

    await a.inject({
      method: "PUT",
      url: `/api/users/${userId}/attendee-role`,
      headers: asUser(admin),
      payload: { role: "mentor" },
    });

    const me = await a.inject({ method: "GET", url: "/api/me", headers: asUser(userId) });
    expect(me.json().hasEventAccess).toBe(true);
  });

  it("an admin/staff account keeps event access after declining their own confirmed spot", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const staffUser = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_DECIDE]);

    // Same user submits, gets accepted, and confirms a spot like any applicant.
    await a.inject({
      method: "PUT",
      url: `/api/applications/${appId}/response`,
      headers: asUser(staffUser),
      payload: { responses: { motivation: "yes" } },
    });
    await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(staffUser),
      payload: { food_intolerances: [], shirt_size: "M" },
    });
    const { rows } = await pool.query(
      `SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2`,
      [staffUser, appId],
    );
    const responseId = rows[0].id;
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/send-decision`,
      headers: asUser(decider),
    });
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/confirm`,
      headers: asUser(staffUser),
    });

    const passId = await createTicketPass(staffUser);

    const decline = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
      headers: asUser(staffUser),
    });
    expect(decline.statusCode).toBe(200);

    // Unlike a plain applicant, the capability keeps event access alive.
    const after = await a.inject({ method: "GET", url: "/api/me", headers: asUser(staffUser) });
    expect(after.json().hasEventAccess).toBe(true);
    expect(await passStatus(passId)).toBe("active");

    const ticket = await a.inject({
      method: "GET",
      url: "/api/me/ticket",
      headers: asUser(staffUser),
    });
    expect(ticket.json().ticketToken).not.toBeNull();
  });

  it("a sponsor representative gets a served, non-null ticket (H43, #426)", async () => {
    const a = await getApp();
    const userId = await createUser({ emailVerified: true });
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);

    const enterprise = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(admin),
      payload: { name: "Acme Corp", visibility: "hidden" },
    });
    expect(enterprise.statusCode).toBe(201);

    const member = await a.inject({
      method: "POST",
      url: `/api/enterprises/${enterprise.json().id}/members`,
      headers: asUser(admin),
      payload: { userId },
    });
    expect(member.statusCode).toBe(201);

    const me = await a.inject({ method: "GET", url: "/api/me", headers: asUser(userId) });
    expect(me.json().hasEventAccess).toBe(true);

    const ticket = await a.inject({
      method: "GET",
      url: "/api/me/ticket",
      headers: asUser(userId),
    });
    expect(ticket.json().ticketToken).not.toBeNull();
  });
});
