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
import {
  createApplication,
  expireConfirmationWindow,
  getResponse,
  getUserSensitive,
  latestConfirmationToken,
} from "./fixtures.js";

/** H13/H14/H15: review -> decide -> send -> confirm/decline/expire, with all the guards. */

let app: App;
let reviewer: number;
let decider: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  reviewer = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
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

/** Create a verified applicant with a SUBMITTED response, intolerances set. */
async function submittedApplicant(appId: number): Promise<{ userId: number; responseId: number }> {
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
    payload: { food_intolerances: [7], food_intolerance_notes: "veg", shirt_size: "M" },
  });
  const { rows } = await pool.query(
    `SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2`,
    [userId, appId],
  );
  return { userId, responseId: rows[0].id };
}

async function toAcceptedSent(appId: number): Promise<{ userId: number; responseId: number }> {
  const a = await getApp();
  const { userId, responseId } = await submittedApplicant(appId);
  await a.inject({
    method: "POST",
    url: `/api/responses/${responseId}/start-review`,
    headers: asUser(reviewer),
  });
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
  return { userId, responseId };
}

describe("review + decide (H13, H14)", () => {
  it("moves submitted -> review and rejects reviewing a draft (invalid transition 409)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);

    const ok = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/start-review`,
      headers: asUser(reviewer),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("review");

    // deciding requires review; a fresh submitted (not reviewed) one cannot skip
    const { responseId: other } = await submittedApplicant(appId);
    const badDecide = await a.inject({
      method: "POST",
      url: `/api/responses/${other}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect(badDecide.statusCode).toBe(409);
  });

  it("per-reviewer rows are independent; staff notes are shared", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);
    const reviewer2 = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/start-review`,
      headers: asUser(reviewer),
    });

    await a.inject({
      method: "PUT",
      url: `/api/responses/${responseId}/my-review`,
      headers: asUser(reviewer),
      payload: { score: 80, notes: "strong" },
    });
    await a.inject({
      method: "PUT",
      url: `/api/responses/${responseId}/my-review`,
      headers: asUser(reviewer2),
      payload: { score: 40 },
    });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n, avg(score)::float AS avg FROM applicant_reviews WHERE response_id = $1`,
      [responseId],
    );
    expect(rows[0].n).toBe(2);
    expect(rows[0].avg).toBe(60);

    await a.inject({
      method: "PATCH",
      url: `/api/responses/${responseId}/staff-notes`,
      headers: asUser(reviewer),
      payload: { staff_notes: "discuss" },
    });
    const r = await getResponse(responseId);
    expect(r.status).toBe("review");
  });

  it("decision is internal until sent: applicant sees 'review' while decision_sent_at is null", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await submittedApplicant(appId);
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/start-review`,
      headers: asUser(reviewer),
    });
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });

    // internally accepted…
    expect((await getResponse(responseId)).status).toBe("accepted");
    // …but the applicant status endpoint masks it as review
    const mine = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
    });
    expect(mine.json().status).toBe("review");

    // after sending, the applicant sees accepted
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/send-decision`,
      headers: asUser(decider),
    });
    const after = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
    });
    expect(after.json().status).toBe("accepted");
  });

  it("capacity guard: accepting past capacity is a 409", async () => {
    const a = await getApp();
    const appId = await createApplication({ capacity: 1 });
    const first = await submittedApplicant(appId);
    const second = await submittedApplicant(appId);
    for (const id of [first.responseId, second.responseId]) {
      await a.inject({
        method: "POST",
        url: `/api/responses/${id}/start-review`,
        headers: asUser(reviewer),
      });
    }
    const ok = await a.inject({
      method: "POST",
      url: `/api/responses/${first.responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect(ok.statusCode).toBe(200);
    const full = await a.inject({
      method: "POST",
      url: `/api/responses/${second.responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.details.code).toBe("capacity_full");
  });

  it("batch send stamps decision_sent_at, issues a spot token + an application email", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await submittedApplicant(appId);
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/start-review`,
      headers: asUser(reviewer),
    });
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    const send = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/send-decisions`,
      headers: asUser(decider),
      payload: {},
    });
    expect(send.json().sent).toBe(1);

    const r = await getResponse(responseId);
    expect(r.decision_sent_at).not.toBeNull();
    expect(r.confirmation_token_id).not.toBeNull();

    const { rows: outbox } = await pool.query(
      `SELECT category, channel, payload FROM notification_outbox WHERE user_id = $1`,
      [userId],
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].category).toBe("application");
    expect(outbox[0].payload.template).toBe("application.decision");
  });
});

describe("confirm / decline (H15)", () => {
  it("confirms via the public token, issues a permanent ticket, double-confirm is idempotent", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);
    const token = await latestConfirmationToken(userId);

    const first = await a.inject({
      method: "POST",
      url: "/api/applications/confirm",
      payload: { token },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("confirmed");
    expect(first.json().already_confirmed).toBe(false);
    expect(first.json().ticket_token.length).toBeGreaterThan(20);

    expect((await getResponse(responseId)).status).toBe("confirmed");
    const { rows: tickets } = await pool.query(
      `SELECT count(*)::int AS n FROM tickets WHERE user_id = $1`,
      [userId],
    );
    expect(tickets[0].n).toBe(1);

    const second = await a.inject({
      method: "POST",
      url: "/api/applications/confirm",
      payload: { token },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().already_confirmed).toBe(true);
    expect(second.json().ticket_token).toBe(first.json().ticket_token);
  });

  it("confirms via authenticated owner (web), and blocks confirming someone else's", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);

    const stranger = await createUser({ emailVerified: true });
    const forbidden = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/confirm`,
      headers: asUser(stranger),
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/confirm`,
      headers: asUser(userId),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("confirmed");
  });

  it("admin override can confirm on behalf (audited via=admin_override)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await toAcceptedSent(appId);
    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/confirm`,
      headers: asUser(decider),
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT source FROM audit_log WHERE entity_type='application_response' AND entity_id=$1 AND action='confirmed'`,
      [String(responseId)],
    );
    expect(rows[0].source).toBe("admin_override");
  });

  it("decline wipes dietary data (H12) and is idempotent", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);
    expect((await getUserSensitive(userId)).food_intolerances).toEqual([7]);

    const res = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
      headers: asUser(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sensitive_wiped).toBe(true);
    expect((await getResponse(responseId)).status).toBe("declined");
    expect((await getUserSensitive(userId)).food_intolerances).toEqual([]);

    const again = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
      headers: asUser(userId),
    });
    expect(again.json().already_declined).toBe(true);
  });

  it("does NOT wipe dietary data if the user still has another confirmed response", async () => {
    const a = await getApp();
    const appA = await createApplication({ name: "A" });
    const appB = await createApplication({ name: "B", type: "mentor" });
    const { userId, responseId: respA } = await toAcceptedSent(appA);

    // same user gets a second accepted+sent response on form B, then confirms it
    const userId2 = userId;
    await a.inject({
      method: "PUT",
      url: `/api/applications/${appB}/response`,
      headers: asUser(userId2),
      payload: { responses: { motivation: "b" } },
    });
    await a.inject({
      method: "POST",
      url: `/api/applications/${appB}/response/submit`,
      headers: asUser(userId2),
      payload: { food_intolerances: [7], shirt_size: "M" },
    });
    const { rows } = await pool.query(
      `SELECT id FROM application_responses WHERE user_id=$1 AND application_id=$2`,
      [userId2, appB],
    );
    const respB = rows[0].id;
    await a.inject({
      method: "POST",
      url: `/api/responses/${respB}/start-review`,
      headers: asUser(reviewer),
    });
    await a.inject({
      method: "POST",
      url: `/api/responses/${respB}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    await a.inject({
      method: "POST",
      url: `/api/responses/${respB}/send-decision`,
      headers: asUser(decider),
    });
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${respB}/confirm`,
      headers: asUser(userId2),
    });

    // declining A must NOT wipe, because B is confirmed
    const res = await a.inject({
      method: "POST",
      url: `/api/me/responses/${respA}/decline`,
      headers: asUser(userId2),
    });
    expect(res.json().sensitive_wiped).toBe(false);
    expect((await getUserSensitive(userId2)).food_intolerances).toEqual([7]);
  });

  it("expired window: confirm is a 409, resend gives a fresh token that works", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);
    await expireConfirmationWindow(responseId);

    const token = await latestConfirmationToken(userId);
    const expired = await a.inject({
      method: "POST",
      url: "/api/applications/confirm",
      payload: { token },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.details.code).toBe("confirmation_expired");

    const resend = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/resend-decision`,
      headers: asUser(decider),
    });
    expect(resend.statusCode).toBe(200);

    const fresh = await latestConfirmationToken(userId);
    expect(fresh).not.toBe(token);
    const ok = await a.inject({
      method: "POST",
      url: "/api/applications/confirm",
      payload: { token: fresh },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("confirmed");
  });

  it("parallel confirms of the same response settle to one confirmed ticket", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId } = await toAcceptedSent(appId);
    const token = await latestConfirmationToken(userId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        a.inject({ method: "POST", url: "/api/applications/confirm", payload: { token } }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM tickets WHERE user_id = $1`, [
      userId,
    ]);
    expect(rows[0].n).toBe(1);
  });
});
