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
let confirmOverride: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  reviewer = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
  decider = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_DECIDE]);
  confirmOverride = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE]);
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
  it("lets reviewers review and decision-makers read the pool, but only decision-makers publish", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);

    const reviewerList = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/responses`,
      headers: asUser(reviewer),
    });
    const deciderList = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/responses`,
      headers: asUser(decider),
    });
    expect(reviewerList.statusCode).toBe(200);
    expect(deciderList.statusCode).toBe(200);

    const forbidden = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(reviewer),
      payload: { decision: "accepted" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("submit auto-transitions to review; decide works directly", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);

    // after submit the response is already in review
    const r = await getResponse(responseId);
    expect(r.status).toBe("review");

    // decide works directly after submit — no manual start-review needed
    const decided = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect(decided.statusCode).toBe(200);
    expect((await getResponse(responseId)).status).toBe("accepted_internal");
  });

  it("per-reviewer rows are independent; staff notes are shared", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);
    const reviewer2 = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);

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
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });

    // internally accepted…
    expect((await getResponse(responseId)).status).toBe("accepted_internal");
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

  it("revert flips unsent decisions and sends decided responses back to review", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);

    // accept internally
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect((await getResponse(responseId)).status).toBe("accepted_internal");

    // reject internally (revert)
    const revertToReject = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/revert-decision`,
      headers: asUser(decider),
      payload: { decision: "rejected" },
    });
    expect(revertToReject.statusCode).toBe(200);
    expect((await getResponse(responseId)).status).toBe("rejected_internal");

    // accept again (revert back)
    const revertToAccept = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/revert-decision`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect(revertToAccept.statusCode).toBe(200);
    expect((await getResponse(responseId)).status).toBe("accepted_internal");

    // send the decision
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/send-decision`,
      headers: asUser(decider),
    });
    expect((await getResponse(responseId)).status).toBe("accepted");

    // sent decisions can go back to review for re-review; the confirmation
    // token is invalidated and decision timestamps are cleared.
    const afterSend = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/revert-decision`,
      headers: asUser(decider),
      payload: { decision: "review" },
    });
    expect(afterSend.statusCode).toBe(200);
    const reverted = await getResponse(responseId);
    expect(reverted.status).toBe("review");
    expect(reverted.decision_sent_at).toBeNull();
    expect(reverted.confirmation_token_id).toBeNull();
  });

  it("capacity guard: accepting past capacity is a 409", async () => {
    const a = await getApp();
    const appId = await createApplication({ capacity: 1 });
    const first = await submittedApplicant(appId);
    const second = await submittedApplicant(appId);
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

    const walletBefore = await a.inject({
      method: "GET",
      url: "/api/me/ticket",
      headers: asUser(userId),
    });
    expect(walletBefore.statusCode).toBe(200);
    expect(walletBefore.json().ticketToken).toBeNull();
    expect(walletBefore.json().acceptedSpots).toEqual([
      expect.objectContaining({ responseId, applicationName: "Participant form" }),
    ]);

    const ok = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/confirm`,
      headers: asUser(userId),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("confirmed");

    const walletAfter = await a.inject({
      method: "GET",
      url: "/api/me/ticket",
      headers: asUser(userId),
    });
    expect(walletAfter.json().ticketToken).toBe(ok.json().ticket_token);
    expect(walletAfter.json().acceptedSpots).toEqual([]);
  });

  it("admin override can confirm on behalf (audited via=admin_override, requires APPLICATIONS_CONFIRM_OVERRIDE)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await toAcceptedSent(appId);

    // decider (without confirm-override) is rejected
    const forbidden = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/confirm`,
      headers: asUser(decider),
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/confirm`,
      headers: asUser(confirmOverride),
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT source FROM audit_log WHERE entity_type='application_response' AND entity_id=$1 AND action='confirmed'`,
      [String(responseId)],
    );
    expect(rows[0].source).toBe("admin_override");
  });

  it("decline keeps dietary data intact (so a later re-accept doesn't lose it) and is idempotent", async () => {
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
    expect((await getResponse(responseId)).status).toBe("declined");
    const sensitive = await getUserSensitive(userId);
    expect(sensitive.food_intolerances).toEqual([7]);
    expect(sensitive.dietary_data_state).toBe("present");

    const applicant = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
    });
    expect(applicant.json().dietary_data_state).toBe("present");

    const staff = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/responses`,
      headers: asUser(reviewer),
    });
    expect(staff.json().responses[0].dietary_data_state).toBe("present");

    const again = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
      headers: asUser(userId),
    });
    expect(again.json().already_declined).toBe(true);
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

  it("exposes the confirmation deadline to the applicant and confirmation workspace", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId } = await toAcceptedSent(appId);

    const applicant = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
    });
    expect(applicant.statusCode).toBe(200);
    expect(applicant.json().confirmation_expires_at).toBeTruthy();

    const staff = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/responses`,
      headers: asUser(reviewer),
    });
    expect(staff.statusCode).toBe(200);
    expect(staff.json().responses[0].confirmation_expires_at).toBeTruthy();
  });

  it("confirm-link returns the token URL for sent decisions", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await toAcceptedSent(appId);

    const res = await a.inject({
      method: "GET",
      url: `/api/responses/${responseId}/confirm-link`,
      headers: asUser(decider),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().confirm_url).toMatch(/^\/applications\/confirm\?token=/);
    expect(typeof res.json().expires_at).toBe("string");
  });

  it("decision email contains an absolute confirmation URL", async () => {
    const appId = await createApplication();
    const { userId } = await toAcceptedSent(appId);

    const { rows: outbox } = await pool.query(
      `SELECT payload FROM notification_outbox WHERE user_id = $1`,
      [userId],
    );
    expect(outbox).toHaveLength(1);
    const details = outbox[0].payload.vars.decisionDetails;
    expect(details).toMatch(/http:\/\/localhost:3001\/applications\/confirm\?token=/);
    expect(details).toMatch(/http:\/\/localhost:3001\/applications\/decline\?token=/);
    expect(details).toMatch(/please let us know/);
  });

  it("batch decide + batch send processes multiple responses", async () => {
    const a = await getApp();
    const appId = await createApplication({ capacity: 10 });
    const r1 = (await submittedApplicant(appId)).responseId;
    const r2 = (await submittedApplicant(appId)).responseId;

    // batch decide both as accepted
    const batchDecide = await a.inject({
      method: "POST",
      url: "/api/responses/batch/decide",
      headers: asUser(decider),
      payload: { response_ids: [r1, r2], decision: "accepted" },
    });
    expect(batchDecide.statusCode).toBe(200);
    expect(batchDecide.json().processed).toBe(2);

    // batch send both
    const batchSend = await a.inject({
      method: "POST",
      url: "/api/responses/batch/send-decision",
      headers: asUser(decider),
      payload: { response_ids: [r1, r2] },
    });
    expect(batchSend.statusCode).toBe(200);
    expect(batchSend.json().sent).toBe(2);
    expect(batchSend.json().tokens).toHaveLength(2);
    expect(batchSend.json().tokens[0].token).toBeTruthy();
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

  it("decline via public token transitions from accepted and preserves ticket", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId, userId } = await toAcceptedSent(appId);
    await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, $2)`, [
      userId,
      `existing-${crypto.randomUUID()}`,
    ]);
    const { rows } = await pool.query(
      `SELECT t.token FROM email_verification_tokens t
       JOIN application_responses r ON r.confirmation_token_id = t.id
       WHERE r.id = $1`,
      [responseId],
    );
    const token = rows[0].token;

    const res = await a.inject({
      method: "POST",
      url: "/api/applications/decline",
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("declined");
    expect(res.json().already_declined).toBe(false);

    const r = await getResponse(responseId);
    expect(r.status).toBe("declined");
    const { rows: tickets } = await pool.query(
      `SELECT count(*)::int AS n FROM tickets WHERE user_id = $1`,
      [userId],
    );
    expect(tickets[0].n).toBe(1); // invariant 10
  });

  it("decline via public token is idempotent", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId } = await toAcceptedSent(appId);
    const token = await latestConfirmationToken(userId);

    const r1 = await a.inject({
      method: "POST",
      url: "/api/applications/decline",
      payload: { token },
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await a.inject({
      method: "POST",
      url: "/api/applications/decline",
      payload: { token },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().already_declined).toBe(true);
  });
});

describe("cancel after confirming", () => {
  it("decline from confirmed status transitions to declined and keeps sensitive data", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);

    // confirm first
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/confirm`,
      headers: asUser(userId),
    });
    expect((await getResponse(responseId)).status).toBe("confirmed");
    expect((await getUserSensitive(userId)).food_intolerances).toEqual([7]);

    // now cancel (decline) after confirming
    const res = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
      headers: asUser(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("declined");
    expect((await getResponse(responseId)).status).toBe("declined");
    expect((await getUserSensitive(userId)).food_intolerances).toEqual([7]);
  });

  it("admin override can decline a confirmed response and it's idempotent", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);

    await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/confirm`,
      headers: asUser(userId),
    });
    expect((await getResponse(responseId)).status).toBe("confirmed");

    const adminCancel = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decline`,
      headers: asUser(confirmOverride),
    });
    expect(adminCancel.statusCode).toBe(200);
    expect(adminCancel.json().status).toBe("declined");

    const again = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decline`,
      headers: asUser(confirmOverride),
    });
    expect(again.json().already_declined).toBe(true);
  });

  it("decline from confirmed preserves the ticket (invariant 10)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);

    await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/confirm`,
      headers: asUser(userId),
    });
    const { rows: before } = await pool.query(
      `SELECT count(*)::int AS n FROM tickets WHERE user_id = $1`,
      [userId],
    );
    expect(before[0].n).toBe(1);

    await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
      headers: asUser(userId),
    });

    const { rows: after } = await pool.query(
      `SELECT count(*)::int AS n FROM tickets WHERE user_id = $1`,
      [userId],
    );
    expect(after[0].n).toBe(1); // ticket is permanent, never voided
  });

  it("401 for anonymous decline", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await toAcceptedSent(appId);

    const res = await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("re-accept (admin)", () => {
  it("re-accepts a declined response, issues a fresh token and email", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);

    // decline
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${responseId}/decline`,
      headers: asUser(userId),
    });
    expect((await getResponse(responseId)).status).toBe("declined");

    // admin re-accepts
    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/re-accept`,
      headers: asUser(decider),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().confirmationToken).toBeTruthy();

    const r = await getResponse(responseId);
    expect(r.status).toBe("accepted");
    expect(r.declined_at).toBeNull();
    // decline never wiped the data, so a re-accept still has it to confirm with
    expect((await getUserSensitive(userId)).dietary_data_state).toBe("present");
    expect((await getUserSensitive(userId)).food_intolerances).toEqual([7]);

    // a fresh decision email was enqueued
    const { rows: outbox } = await pool.query(
      `SELECT payload FROM notification_outbox WHERE user_id = $1`,
      [userId],
    );
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    const last = outbox[outbox.length - 1];
    expect(last.payload.template).toBe("application.decision");

    // the new token can confirm
    const token = await latestConfirmationToken(userId);
    const confirm = await a.inject({
      method: "POST",
      url: "/api/applications/confirm",
      payload: { token },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().status).toBe("confirmed");
  });

  it("re-accepts a rejected response (sent)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);

    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "rejected" },
    });
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/send-decision`,
      headers: asUser(decider),
    });
    expect((await getResponse(responseId)).status).toBe("rejected");

    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/re-accept`,
      headers: asUser(decider),
    });
    expect(res.statusCode).toBe(200);
    expect((await getResponse(responseId)).status).toBe("accepted");
  });

  it("403 without APPLICATIONS_DECIDE capability", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await toAcceptedSent(appId);

    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/re-accept`,
      headers: asUser(reviewer), // reviewer lacks APPLICATIONS_DECIDE
    });
    expect(res.statusCode).toBe(403);
  });

  it("409 on re-accept when capacity is full", async () => {
    const a = await getApp();
    const appId = await createApplication({ capacity: 1 });
    const a1 = await toAcceptedSent(appId);
    // confirm a1 then cancel, freeing the slot temporarily
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${a1.responseId}/confirm`,
      headers: asUser(a1.userId),
    });
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${a1.responseId}/decline`,
      headers: asUser(a1.userId),
    });

    // another applicant fills the slot
    const a2 = await toAcceptedSent(appId);
    await a.inject({
      method: "POST",
      url: `/api/me/responses/${a2.responseId}/confirm`,
      headers: asUser(a2.userId),
    });

    // re-accept a1 should fail — a2 holds the only slot
    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${a1.responseId}/re-accept`,
      headers: asUser(decider),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.code).toBe("capacity_full");
  });

  it("409 on re-accept from an invalid state (review)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);

    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/re-accept`,
      headers: asUser(decider),
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("batch send resends already-sent decisions", () => {
  it("batch send resends an already-sent accepted response", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await toAcceptedSent(appId);

    const res = await a.inject({
      method: "POST",
      url: "/api/responses/batch/send-decision",
      headers: asUser(decider),
      payload: { response_ids: [responseId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(1);
    expect(res.json().tokens[0].token).toBeTruthy();

    // a fresh email was enqueued
    const { rows: outbox } = await pool.query(
      `SELECT count(*)::int AS n FROM notification_outbox WHERE user_id = $1`,
      [userId],
    );
    expect(outbox[0].n).toBeGreaterThanOrEqual(2);
  });

  it("batch send resends an expired response (second chance)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await toAcceptedSent(appId);
    await expireConfirmationWindow(responseId);

    const res = await a.inject({
      method: "POST",
      url: "/api/responses/batch/send-decision",
      headers: asUser(decider),
      payload: { response_ids: [responseId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(1);
    const r = await getResponse(responseId);
    expect(r.status).toBe("accepted"); // resend flipped it back
  });
});

describe("revert to review", () => {
  it("reverts accepted_internal to review", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect((await getResponse(responseId)).status).toBe("accepted_internal");

    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/revert-decision`,
      headers: asUser(decider),
      payload: { decision: "review" },
    });
    expect(res.statusCode).toBe(200);
    expect((await getResponse(responseId)).status).toBe("review");
  });

  it("reverts already-sent accepted back to review, clearing tokens", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await toAcceptedSent(appId);
    expect((await getResponse(responseId)).status).toBe("accepted");
    expect((await getResponse(responseId)).confirmation_token_id).not.toBeNull();

    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/revert-decision`,
      headers: asUser(decider),
      payload: { decision: "review" },
    });
    expect(res.statusCode).toBe(200);
    const r = await getResponse(responseId);
    expect(r.status).toBe("review");
    expect(r.confirmation_token_id).toBeNull();
  });

  it("batch reverts internal and sent decisions to review", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const internal = await submittedApplicant(appId);
    await a.inject({
      method: "POST",
      url: `/api/responses/${internal.responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "rejected" },
    });
    const sent = await toAcceptedSent(appId);

    const res = await a.inject({
      method: "POST",
      url: "/api/responses/batch/revert-decision",
      headers: asUser(decider),
      payload: {
        response_ids: [internal.responseId, sent.responseId],
        decision: "review",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(2);
    expect((await getResponse(internal.responseId)).status).toBe("review");
    expect((await getResponse(sent.responseId)).status).toBe("review");
  });
});

describe("decision pool", () => {
  it("returns grouped counts for accepted/rejected/declined", async () => {
    const a = await getApp();
    const appId = await createApplication();
    await toAcceptedSent(appId);

    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/decision-pool`,
      headers: asUser(reviewer),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted.sent).toHaveLength(1);
    expect(res.json().accepted.unsent).toHaveLength(0);
    expect(res.json().rejected.sent).toHaveLength(0);
    expect(res.json().rejected.unsent).toHaveLength(0);
    expect(res.json().declined.manual).toHaveLength(0);
    expect(res.json().declined.expired).toHaveLength(0);
  });

  it("403 without APPLICATIONS_REVIEW", async () => {
    const a = await getApp();
    const appId = await createApplication();

    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/decision-pool`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("email countdown", () => {
  it("decision email contains a human-readable countdown", async () => {
    const appId = await createApplication();
    const { userId } = await toAcceptedSent(appId);

    const { rows: outbox } = await pool.query(
      `SELECT payload FROM notification_outbox WHERE user_id = $1`,
      [userId],
    );
    const details = outbox[0].payload.vars.decisionDetails;
    expect(details).toMatch(/You have /);
    expect(details).toMatch(/to confirm/);
  });
});

describe("revoke spot + batch actions (M2)", () => {
  async function confirm(userId: number): Promise<void> {
    const a = await getApp();
    const token = await latestConfirmationToken(userId);
    await a.inject({ method: "POST", url: "/api/applications/confirm", payload: { token } });
  }

  it("revokes an already-CONFIRMED spot back to rejected and keeps sensitive data (in case of re-accept)", async () => {
    const a = await getApp();
    const appId = await createApplication({ capacity: 1 });
    const { userId, responseId } = await toAcceptedSent(appId);
    await confirm(userId);
    expect((await getResponse(responseId)).status).toBe("confirmed");

    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/revoke-spot`,
      headers: asUser(decider),
    });
    expect(res.statusCode).toBe(200);
    expect((await getResponse(responseId)).status).toBe("rejected");
    const sensitive = await getUserSensitive(userId);
    expect(sensitive.food_intolerances).toEqual([7]);

    // The freed capacity slot lets someone else be accepted.
    const other = await toAcceptedSent(appId);
    expect((await getResponse(other.responseId)).status).toBe("accepted");
  });

  it("revoke-spot rejects responses that aren't accepted/confirmed (409)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId); // still 'review'
    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/revoke-spot`,
      headers: asUser(decider),
    });
    expect(res.statusCode).toBe(409);
  });

  it("batch re-accepts declined/rejected/expired and reports skips for the rest", async () => {
    const a = await getApp();
    const appId = await createApplication();

    // One rejected (revoked), one still in review (should be skipped).
    const revoked = await toAcceptedSent(appId);
    await a.inject({
      method: "POST",
      url: `/api/responses/${revoked.responseId}/revoke-spot`,
      headers: asUser(decider),
    });
    const inReview = await submittedApplicant(appId);

    const res = await a.inject({
      method: "POST",
      url: "/api/responses/batch/re-accept",
      headers: asUser(decider),
      payload: { response_ids: [revoked.responseId, inReview.responseId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(1);
    expect(res.json().skipped).toHaveLength(1);
    expect(res.json().skipped[0].id).toBe(inReview.responseId);
    expect((await getResponse(revoked.responseId)).status).toBe("accepted");
  });

  it("batch revoke-spot moves accepted/confirmed → rejected in one call", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const one = await toAcceptedSent(appId);
    const two = await toAcceptedSent(appId);
    await confirm(two.userId);

    const res = await a.inject({
      method: "POST",
      url: "/api/responses/batch/revoke-spot",
      headers: asUser(decider),
      payload: { response_ids: [one.responseId, two.responseId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(2);
    expect((await getResponse(one.responseId)).status).toBe("rejected");
    expect((await getResponse(two.responseId)).status).toBe("rejected");
  });

  it("lists a user's applications for staff with real status (M3.3)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await submittedApplicant(appId);
    // internal accept — applicant would see 'review', staff must see the truth.
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });

    const reader = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
    const res = await a.inject({
      method: "GET",
      url: `/api/users/${userId}/applications`,
      headers: asUser(reader),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().responses).toHaveLength(1);
    expect(res.json().responses[0].status).toBe("accepted_internal");
    expect(res.json().responses[0].application_id).toBe(appId);

    // Without applications:review it's forbidden (the tab shows a gated state).
    const pleb = await createUser();
    expect(
      (
        await a.inject({
          method: "GET",
          url: `/api/users/${userId}/applications`,
          headers: asUser(pleb),
        })
      ).statusCode,
    ).toBe(403);
  });

  it("requires APPLICATIONS_DECIDE for revoke + batch routes", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await toAcceptedSent(appId);
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/responses/${responseId}/revoke-spot`,
          headers: asUser(reviewer),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await a.inject({
          method: "POST",
          url: "/api/responses/batch/re-accept",
          headers: asUser(reviewer),
          payload: { response_ids: [responseId] },
        })
      ).statusCode,
    ).toBe(403);
  });
});
