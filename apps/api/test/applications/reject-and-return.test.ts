import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { renderEmailTemplate } from "../../src/modules/notifications/templates.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { createApplication, getResponse } from "./fixtures.js";

/** H12/H13/H14: an internal reject-and-return, sent like any decision, then re-reviewed. */

const getApp = useTestApp();
let reviewer: number;
let decider: number;

beforeEach(async () => {
  reviewer = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
  decider = await createUserWithCapabilities([
    CAPABILITIES.APPLICATIONS_DECIDE,
    CAPABILITIES.APPLICATIONS_REVIEW,
  ]);
});

async function submittedApplicant(appId: number): Promise<{ userId: number; responseId: number }> {
  const a = await getApp();
  const userId = await createUser({ emailVerified: true });
  await a.inject({
    method: "PUT",
    url: `/api/applications/${appId}/response`,
    headers: asUser(userId),
    payload: { responses: { motivation: "yes" } },
  });
  const submitted = await a.inject({
    method: "POST",
    url: `/api/applications/${appId}/response/submit`,
    headers: asUser(userId),
    payload: { food_intolerances: [], shirt_size: "M" },
  });
  expect(submitted.statusCode).toBe(200);
  const { rows } = await pool.query(
    `SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2`,
    [userId, appId],
  );
  return { userId, responseId: rows[0].id };
}

async function rejectAndReturn(responseId: number, reason: string | null): Promise<void> {
  const a = await getApp();
  const decided = await a.inject({
    method: "POST",
    url: `/api/responses/${responseId}/decide`,
    headers: asUser(decider),
    payload: { decision: "rejected", return_to_draft: true },
  });
  expect(decided.statusCode).toBe(200);
  if (reason) {
    const saved = await a.inject({
      method: "PATCH",
      url: `/api/responses/${responseId}/rejection-reason`,
      headers: asUser(decider),
      payload: { reason },
    });
    expect(saved.statusCode).toBe(200);
  }
}

async function outbox(userId: number) {
  const { rows } = await pool.query(
    `SELECT payload FROM notification_outbox WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows.map((row) => row.payload);
}

describe("reject-and-return (H12, H13, H14)", () => {
  it("stays internal until sent, then returns a resubmittable draft and shows the history on re-review", async () => {
    const a = await getApp();
    const appId = await createApplication({
      close_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const { userId, responseId } = await submittedApplicant(appId);
    await rejectAndReturn(responseId, "Falta el enlace a tu portfolio");

    // Internal: the applicant still sees it under review and nothing is queued.
    expect((await getResponse(responseId)).status).toBe("rejected_internal");
    expect((await getResponse(responseId)).return_on_send).toBe(true);
    const mine = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
    });
    expect(mine.json().status).toBe("review");
    expect(mine.json().rejection_reason).toBeNull();
    expect(await outbox(userId)).toEqual([]);

    const sent = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/send-decision`,
      headers: asUser(decider),
    });
    expect(sent.statusCode).toBe(200);
    const returned = await getResponse(responseId);
    expect(returned).toMatchObject({
      status: "draft",
      return_on_send: false,
      allow_resubmit_after_close: true,
      decision_sent_at: null,
      submitted_at: null,
      rejection_reason: "Falta el enlace a tu portfolio",
    });
    const [email] = await outbox(userId);
    expect(email.template).toBe("application.returned");
    expect(email.vars.applicationUrl).toContain(`/my-applications/${appId}`);
    expect(email.vars.rejectionDetails).toContain("Falta el enlace a tu portfolio");
    const rendered = renderEmailTemplate(email, "es");
    expect(rendered.subject).toContain("necesita cambios");
    expect(rendered.text).toContain("Falta el enlace a tu portfolio");

    // The applicant sees the reason on the draft and can resubmit after close.
    const draft = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
    });
    expect(draft.json()).toMatchObject({
      status: "draft",
      rejection_reason: "Falta el enlace a tu portfolio",
      can_delete_draft: false,
    });
    await pool.query(
      `UPDATE applications SET close_at = now() - interval '1 minute' WHERE id = $1`,
      [appId],
    );
    const resubmitted = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(userId),
      payload: { food_intolerances: [], shirt_size: "M" },
    });
    expect(resubmitted.statusCode).toBe(200);
    expect(resubmitted.json().response.rejection_reason).toBeNull();
    expect(await getResponse(responseId)).toMatchObject({
      status: "review",
      rejection_reason: null,
    });

    // Re-review: reviewers see that it was rejected before, and why.
    for (const viewer of [reviewer, decider]) {
      const list = await a.inject({
        method: "GET",
        url: `/api/applications/${appId}/responses`,
        headers: asUser(viewer),
      });
      expect(list.statusCode).toBe(200);
      const row = list.json().responses.find((r: { id: number }) => r.id === responseId);
      expect(row.previous_rejections).toEqual([
        expect.objectContaining({
          reason: "Falta el enlace a tu portfolio",
          notified: true,
          returned: true,
        }),
      ]);
    }
    const detail = await a.inject({
      method: "GET",
      url: `/api/responses/${responseId}`,
      headers: asUser(reviewer),
    });
    expect(detail.json().response.previous_rejections).toHaveLength(1);
    expect(detail.json().response.previous_rejections[0].rejected_by_name).not.toBeUndefined();

    // Private reason text never reaches the audit trail.
    const { rows: audits } = await pool.query(
      `SELECT action, before, after FROM audit_log
        WHERE entity_type = 'application_response' AND entity_id = $1`,
      [String(responseId)],
    );
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining(["decided_rejected", "decision_sent"]),
    );
    const sentAudit = audits.find((row) => row.action === "decision_sent");
    expect(sentAudit?.after).toMatchObject({ decision: "returned", status: "draft" });
  });

  it("can be toggled on an unsent rejection and is cleared by any other decision", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);
    const revert = (payload: Record<string, unknown>) =>
      a.inject({
        method: "POST",
        url: `/api/responses/${responseId}/revert-decision`,
        headers: asUser(decider),
        payload,
      });

    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "rejected" },
    });
    expect((await getResponse(responseId)).return_on_send).toBe(false);
    expect((await revert({ decision: "rejected", return_to_draft: true })).statusCode).toBe(200);
    expect((await getResponse(responseId)).return_on_send).toBe(true);
    expect((await revert({ decision: "rejected" })).statusCode).toBe(200);
    expect((await getResponse(responseId)).return_on_send).toBe(false);

    expect((await revert({ decision: "rejected", return_to_draft: true })).statusCode).toBe(200);
    expect((await revert({ decision: "accepted" })).statusCode).toBe(200);
    expect(await getResponse(responseId)).toMatchObject({
      status: "accepted_internal",
      return_on_send: false,
    });
    expect((await revert({ decision: "accepted", return_to_draft: true })).statusCode).toBe(409);

    expect((await revert({ decision: "rejected", return_to_draft: true })).statusCode).toBe(200);
    expect((await revert({ decision: "review" })).statusCode).toBe(200);
    expect(await getResponse(responseId)).toMatchObject({
      status: "review",
      return_on_send: false,
    });

    const acceptReturn = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "accepted", return_to_draft: true },
    });
    expect(acceptReturn.statusCode).toBe(409);
    expect((await getResponse(responseId)).status).toBe("review");
  });

  it("requires decision access", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { responseId } = await submittedApplicant(appId);
    const denied = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(reviewer),
      payload: { decision: "rejected", return_to_draft: true },
    });
    expect(denied.statusCode).toBe(403);
    expect((await getResponse(responseId)).status).toBe("review");
  });

  it("is sent by batch decide + batch send alongside ordinary decisions", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const returning = await submittedApplicant(appId);
    const final = await submittedApplicant(appId);
    const decided = await a.inject({
      method: "POST",
      url: "/api/responses/batch/decide",
      headers: asUser(decider),
      payload: {
        response_ids: [returning.responseId],
        decision: "rejected",
        return_to_draft: true,
      },
    });
    expect(decided.statusCode).toBe(200);
    await a.inject({
      method: "POST",
      url: `/api/responses/${final.responseId}/decide`,
      headers: asUser(decider),
      payload: { decision: "rejected" },
    });
    const sent = await a.inject({
      method: "POST",
      url: "/api/responses/batch/send-decision",
      headers: asUser(decider),
      payload: { response_ids: [returning.responseId, final.responseId] },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().sent).toBe(2);
    expect((await getResponse(returning.responseId)).status).toBe("draft");
    expect((await getResponse(final.responseId)).status).toBe("rejected");
    expect((await outbox(returning.userId)).map((p) => p.template)).toEqual([
      "application.returned",
    ]);
    expect((await outbox(final.userId)).map((p) => p.template)).toEqual(["application.decision"]);
  });

  it("concurrent sends return the draft and email the applicant exactly once", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const { userId, responseId } = await submittedApplicant(appId);
    await rejectAndReturn(responseId, "Motivo");
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        a.inject({
          method: "POST",
          url: `/api/responses/${responseId}/send-decision`,
          headers: asUser(decider),
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(2);
    expect(await outbox(userId)).toHaveLength(1);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM application_response_rejections WHERE response_id = $1`,
      [responseId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("an ordinary return to draft of a sent rejection also keeps it for the re-review", async () => {
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
      method: "PATCH",
      url: `/api/responses/${responseId}/rejection-reason`,
      headers: asUser(decider),
      payload: { reason: "Sin experiencia previa" },
    });
    await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/send-decision`,
      headers: asUser(decider),
    });
    const returned = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/return-to-draft`,
      headers: { ...asUser(decider), "idempotency-key": "reject-history-return-1" },
      payload: { allow_resubmit_after_close: false, auto_accept_on_resubmit: false },
    });
    expect(returned.statusCode).toBe(200);
    expect((await getResponse(responseId)).rejection_reason).toBeNull();
    const detail = await a.inject({
      method: "GET",
      url: `/api/responses/${responseId}`,
      headers: asUser(reviewer),
    });
    expect(detail.json().response.previous_rejections).toEqual([
      expect.objectContaining({
        reason: "Sin experiencia previa",
        notified: true,
        returned: false,
      }),
    ]);
  });
});
