import "./env.js";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { asUser, createUser, useTestApp } from "../helpers.js";
import { createApplication, createResponse } from "./fixtures.js";

const getApp = useTestApp();

describe("discard an application draft (H12)", () => {
  it("allows an unverified owner without event access to discard a closed draft and retry", async () => {
    const app = await getApp();
    const owner = await createUser({ emailVerified: false });
    const application = await createApplication({ close_at: "2020-01-01T00:00:00Z" });
    const response = await createResponse(owner, application, { status: "draft" });
    const mentor = await createApplication({ type: "mentor" });
    const mentorResponse = await createResponse(owner, mentor, { status: "draft" });
    const request = {
      method: "DELETE" as const,
      url: `/api/applications/${application}/response`,
      headers: { ...asUser(owner), "idempotency-key": crypto.randomUUID() },
    };
    expect((await app.inject(request)).statusCode).toBe(204);
    expect((await app.inject(request)).statusCode).toBe(204);
    expect((await pool.query(`SELECT id FROM application_responses ORDER BY id`)).rows).toEqual([
      { id: mentorResponse },
    ]);
    expect(
      (
        await pool.query(
          `SELECT actor_id, entity_id, action FROM audit_log WHERE entity_type = 'application_response'`,
        )
      ).rows,
    ).toEqual([{ actor_id: owner, entity_id: String(response), action: "draft_deleted" }]);
  });

  it("never deletes another person's draft and requires a session", async () => {
    const app = await getApp();
    const owner = await createUser();
    const other = await createUser();
    const application = await createApplication();
    await createResponse(owner, application, { status: "draft" });
    const url = `/api/applications/${application}/response`;
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url,
          headers: { ...asUser(other), "idempotency-key": crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    expect((await pool.query(`SELECT id FROM application_responses`)).rowCount).toBe(1);
  });

  it.each([
    "review",
    "accepted",
    "confirmed",
    "rejected",
    "declined",
    "expired",
    "draft",
  ])("preserves previously submitted responses in %s state", async (status) => {
    const app = await getApp();
    const owner = await createUser();
    const application = await createApplication();
    const response = await createResponse(owner, application, { status });
    await pool.query(`UPDATE application_responses SET submitted_at = now() WHERE id = $1`, [
      response,
    ]);
    const result = await app.inject({
      method: "DELETE",
      url: `/api/applications/${application}/response`,
      headers: { ...asUser(owner), "idempotency-key": crypto.randomUUID() },
    });
    expect(result.statusCode).toBe(409);
    expect((await pool.query(`SELECT id FROM application_responses`)).rowCount).toBe(1);
  });

  it("protects a staff-returned draft even when its submitted_at was cleared", async () => {
    const app = await getApp();
    const owner = await createUser();
    const application = await createApplication();
    const response = await createResponse(owner, application, { status: "review" });
    const { returnToDraft } = await import("../../src/modules/applications/service.js");
    await returnToDraft(owner, response, {
      allow_resubmit_after_close: false,
      auto_accept_on_resubmit: false,
    });
    const listing = await app.inject({
      method: "GET",
      url: "/api/me/applications",
      headers: asUser(owner),
    });
    expect(listing.json().responses[0]).toMatchObject({
      status: "draft",
      submitted_at: null,
      can_delete_draft: false,
    });
    const result = await app.inject({
      method: "DELETE",
      url: `/api/applications/${application}/response`,
      headers: asUser(owner),
    });
    expect(result.statusCode).toBe(409);
  });

  it("never deletes a response that wins a concurrent submission", async () => {
    const app = await getApp();
    const owner = await createUser();
    const application = await createApplication({
      template: [],
      ask_shirt_size: false,
      ask_food_intolerances: false,
    });
    await createResponse(owner, application, { status: "draft" });
    const [removed, submitted] = await Promise.all([
      app.inject({
        method: "DELETE",
        url: `/api/applications/${application}/response`,
        headers: { ...asUser(owner), "idempotency-key": crypto.randomUUID() },
      }),
      app.inject({
        method: "POST",
        url: `/api/applications/${application}/response/submit`,
        headers: asUser(owner),
        payload: { responses: {}, food_intolerances: [] },
      }),
    ]);
    const { rows } = await pool.query(
      `SELECT status FROM application_responses WHERE user_id = $1`,
      [owner],
    );
    if (submitted.statusCode === 200) {
      expect(removed.statusCode).toBe(409);
      expect(rows).toEqual([{ status: "review" }]);
    } else {
      expect(removed.statusCode).toBe(204);
      expect(submitted.statusCode).toBe(404);
      expect(rows).toEqual([]);
    }
  });

  it("serializes concurrent deletion into one audited mutation", async () => {
    const app = await getApp();
    const owner = await createUser();
    const application = await createApplication();
    await createResponse(owner, application, { status: "draft" });
    const results = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "DELETE",
          url: `/api/applications/${application}/response`,
          headers: { ...asUser(owner), "idempotency-key": crypto.randomUUID() },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 404]);
    expect(
      (await pool.query(`SELECT id FROM audit_log WHERE action = 'draft_deleted'`)).rowCount,
    ).toBe(1);
  });
});
