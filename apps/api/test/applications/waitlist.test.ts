import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { renderEmailTemplate } from "../../src/modules/notifications/templates.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { createApplication, getResponse } from "./fixtures.js";

/** H11/H12/H13/H14: waitlist mode, moving reviewed responses to it, leaving it. */

const getApp = useTestApp();
let decider: number;
let manager: number;

beforeEach(async () => {
  decider = await createUserWithCapabilities([
    CAPABILITIES.APPLICATIONS_DECIDE,
    CAPABILITIES.APPLICATIONS_REVIEW,
  ]);
  manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
});

async function configure(appId: number, waitlist_enabled: boolean, waitlist_after: number | null) {
  const a = await getApp();
  const res = await a.inject({
    method: "PATCH",
    url: `/api/applications/${appId}`,
    headers: asUser(manager),
    payload: { waitlist_enabled, waitlist_after },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function submit(appId: number, payload: Record<string, unknown> = {}) {
  const a = await getApp();
  const userId = await createUser({ emailVerified: true });
  await a.inject({
    method: "PUT",
    url: `/api/applications/${appId}/response`,
    headers: asUser(userId),
    payload: { responses: { motivation: "yes" } },
  });
  const res = await a.inject({
    method: "POST",
    url: `/api/applications/${appId}/response/submit`,
    headers: asUser(userId),
    payload: { food_intolerances: [], shirt_size: "M", ...payload },
  });
  const { rows } = await pool.query(
    `SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2`,
    [userId, appId],
  );
  return { userId, responseId: rows[0].id as number, res };
}

describe("waitlist mode", () => {
  it("stays off by default and exposes its state on the public form", async () => {
    const appId = await createApplication();
    const a = await getApp();
    const form = await a.inject({ method: "GET", url: `/api/public/applications/${appId}` });
    expect(form.json()).toMatchObject({
      waitlist_enabled: false,
      waitlist_active: false,
      applications_received: 0,
    });
    const { res, responseId } = await submit(appId);
    expect(res.statusCode).toBe(200);
    expect((await getResponse(responseId)).status).toBe("review");
  });

  it("starts at once when enabled without a threshold and requires an explicit acknowledgement", async () => {
    const appId = await createApplication();
    const form = await configure(appId, true, null);
    expect(form).toMatchObject({ waitlist_active: true, waitlist_after: null });

    const refused = await submit(appId);
    expect(refused.res.statusCode).toBe(409);
    expect(refused.res.json().error.details.code).toBe("waitlist_required");
    expect((await getResponse(refused.responseId)).status).toBe("draft");

    const joined = await submit(appId, { waitlist_ack: true });
    expect(joined.res.statusCode).toBe(200);
    expect(joined.res.json().response.status).toBe("waitlist");
    expect((await getResponse(joined.responseId)).status).toBe("waitlist");
  });

  it("starts once the threshold of received applications is reached", async () => {
    const appId = await createApplication();
    await configure(appId, true, 2);
    expect((await submit(appId)).res.statusCode).toBe(200);
    const second = await submit(appId);
    expect((await getResponse(second.responseId)).status).toBe("review");

    const a = await getApp();
    const form = await a.inject({ method: "GET", url: `/api/public/applications/${appId}` });
    expect(form.json()).toMatchObject({ waitlist_active: true, applications_received: 2 });

    const third = await submit(appId, { waitlist_ack: true });
    expect((await getResponse(third.responseId)).status).toBe("waitlist");
  });

  it("does not reopen a closed form", async () => {
    const appId = await createApplication({ close_at: "2020-01-01T00:00:00Z" });
    await configure(appId, true, null);
    const a = await getApp();
    const userId = await createUser({ emailVerified: true });
    const res = await a.inject({
      method: "PUT",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
      payload: { responses: { motivation: "yes" } },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects a non-positive threshold", async () => {
    const appId = await createApplication();
    const a = await getApp();
    const res = await a.inject({
      method: "PATCH",
      url: `/api/applications/${appId}`,
      headers: asUser(manager),
      payload: { waitlist_after: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("moving reviewed responses to the waitlist", () => {
  it("notifies the applicant, keeps the place free and can later be accepted", async () => {
    const appId = await createApplication({ capacity: 1 });
    const first = await submit(appId);
    const second = await submit(appId);
    const a = await getApp();

    const moved = await a.inject({
      method: "POST",
      url: `/api/responses/${second.responseId}/waitlist`,
      headers: asUser(decider),
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().status).toBe("waitlist");

    const mine = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/response`,
      headers: asUser(second.userId),
    });
    expect(mine.json().status).toBe("waitlist");

    const { rows: outbox } = await pool.query(
      `SELECT payload FROM notification_outbox WHERE user_id = $1 AND channel = 'email'`,
      [second.userId],
    );
    expect(outbox).toHaveLength(1);
    const rendered = renderEmailTemplate(outbox[0].payload, "es");
    expect(rendered.subject).toContain("lista de espera");

    // The waitlisted response does not take the only place.
    const acceptFirst = await a.inject({
      method: "POST",
      url: `/api/responses/${first.responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect(acceptFirst.statusCode).toBe(200);
    const acceptWaitlisted = await a.inject({
      method: "POST",
      url: `/api/responses/${second.responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect(acceptWaitlisted.statusCode).toBe(409);

    // Free the place, then the waitlisted response can be accepted and sent.
    await a.inject({
      method: "POST",
      url: `/api/responses/${first.responseId}/revert-decision`,
      headers: asUser(decider),
      payload: { decision: "rejected" },
    });
    const accepted = await a.inject({
      method: "POST",
      url: `/api/responses/${second.responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted" },
    });
    expect(accepted.statusCode).toBe(200);
    const sent = await a.inject({
      method: "POST",
      url: `/api/responses/${second.responseId}/send-decision`,
      headers: asUser(decider),
    });
    expect(sent.statusCode).toBe(200);
    expect((await getResponse(second.responseId)).status).toBe("accepted");
  });

  it("moves a batch and reports the rows that cannot move", async () => {
    const appId = await createApplication();
    const one = await submit(appId);
    const two = await submit(appId);
    const a = await getApp();
    await pool.query(`UPDATE application_responses SET status = 'confirmed' WHERE id = $1`, [
      two.responseId,
    ]);
    const res = await a.inject({
      method: "POST",
      url: "/api/responses/batch/waitlist",
      headers: asUser(decider),
      payload: { response_ids: [one.responseId, two.responseId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(1);
    expect(res.json().skipped).toHaveLength(1);
    expect((await getResponse(one.responseId)).status).toBe("waitlist");
  });

  it("requires the decide capability", async () => {
    const appId = await createApplication();
    const { responseId } = await submit(appId);
    const reviewerOnly = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
    const a = await getApp();
    const res = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/waitlist`,
      headers: asUser(reviewerOnly),
    });
    expect(res.statusCode).toBe(403);
  });

  it("lists waitlisted responses in the decision pool and filters by status", async () => {
    const appId = await createApplication();
    const { responseId } = await submit(appId);
    const a = await getApp();
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/waitlist`,
      headers: asUser(decider),
    });
    const pool_ = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/decision-pool`,
      headers: asUser(decider),
    });
    expect(pool_.json().waitlist.map((r: { id: number }) => r.id)).toEqual([responseId]);
    const list = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/responses?status=waitlist`,
      headers: asUser(decider),
    });
    expect(list.json().responses ?? list.json()).toHaveLength(1);
  });
});

describe("leaving the waitlist", () => {
  it("lets a directly waitlisted applicant withdraw, audited", async () => {
    const appId = await createApplication();
    await configure(appId, true, null);
    const { userId, responseId } = await submit(appId, { waitlist_ack: true });
    const a = await getApp();
    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/withdraw`,
      headers: asUser(userId),
    });
    expect(res.statusCode).toBe(200);
    const row = await getResponse(responseId);
    expect(row.status).toBe("declined");
    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'application_response' AND entity_id = $1`,
      [String(responseId)],
    );
    expect(rows.map((r) => r.action)).toContain("waitlist_withdrawn");
  });

  it("lets an applicant moved by staff withdraw, but not one that is only in review", async () => {
    const appId = await createApplication();
    const moved = await submit(appId);
    const inReview = await submit(appId);
    const a = await getApp();
    await a.inject({
      method: "POST",
      url: `/api/responses/${moved.responseId}/waitlist`,
      headers: asUser(decider),
    });
    const ok = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/withdraw`,
      headers: asUser(moved.userId),
    });
    expect(ok.statusCode).toBe(200);
    const refused = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/withdraw`,
      headers: asUser(inReview.userId),
    });
    expect(refused.statusCode).toBe(409);
  });
});
