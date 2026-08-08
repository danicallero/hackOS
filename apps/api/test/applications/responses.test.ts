import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";
import { createApplication, getUserSensitive } from "./fixtures.js";

/** H12: draft, submit, verified-email gate, sensitive-data-to-user, privacy notice. */

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

function saveDraft(a: App, appId: number, userId: number, responses: Record<string, unknown>) {
  return a.inject({
    method: "PUT",
    url: `/api/applications/${appId}/response`,
    headers: asUser(userId),
    payload: { responses },
  });
}

describe("application responses (H12)", () => {
  it("saves a draft with no required-field enforcement, then keeps it editable", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const user = await createUser();

    const draft = await saveDraft(a, appId, user, {}); // motivation missing — fine while drafting
    expect(draft.statusCode).toBe(200);
    expect(draft.json().status).toBe("draft");

    const edit = await saveDraft(a, appId, user, { motivation: "later" });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().responses.motivation).toBe("later");
  });

  it("409 when creating a NEW draft after the window closed", async () => {
    const a = await getApp();
    const past = new Date(Date.now() - 3600_000).toISOString();
    const appId = await createApplication({ open_at: past, close_at: past });
    const user = await createUser();

    const res = await saveDraft(a, appId, user, { motivation: "x" });
    expect(res.statusCode).toBe(409);
  });

  it("blocks submit until the email is verified (403 email_not_verified)", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const user = await createUser({ emailVerified: false });
    await saveDraft(a, appId, user, { motivation: "ready" });

    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [], shirt_size: "M" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.code).toBe("email_not_verified");
  });

  it("enforces required fields at submit", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const user = await createUser({ emailVerified: true });
    await saveDraft(a, appId, user, {}); // motivation missing

    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [], shirt_size: "M" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fields.motivation).toBe("required");
  });

  it("requires shirt size when the form asks for it (ask_shirt_size)", async () => {
    const a = await getApp();
    const appId = await createApplication({ type: "participant" }); // fixture defaults ask_shirt_size true for participant
    const user = await createUser({ emailVerified: true });
    await saveDraft(a, appId, user, { motivation: "x" });

    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.code).toBe("shirt_size_required");
  });

  it("does not require shirt size when the form doesn't ask for it, even for participant type", async () => {
    const a = await getApp();
    const appId = await createApplication({
      type: "participant",
      ask_shirt_size: false,
      ask_food_intolerances: false,
    });
    const user = await createUser({ emailVerified: true });
    await saveDraft(a, appId, user, { motivation: "x" });

    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [] },
    });
    expect(res.statusCode).toBe(200);
  });

  it("volunteer forms can opt in to asking for shirt size", async () => {
    const a = await getApp();
    const appId = await createApplication({ type: "volunteer", ask_shirt_size: true });
    const user = await createUser({ emailVerified: true });
    await saveDraft(a, appId, user, { motivation: "x" });

    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.code).toBe("shirt_size_required");
  });

  it("submits: keeps dietary data only on the user and returns the privacy notice", async () => {
    const a = await getApp();
    const appId = await createApplication({ type: "participant" });
    const user = await createUser({ emailVerified: true });
    await saveDraft(a, appId, user, {
      motivation: "x",
      credits: "yes",
      food_intolerances: [],
      food_intolerance_notes: "draft note",
    });

    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [1, 2], food_intolerance_notes: "no nuts", shirt_size: "L" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().response.status).toBe("review");
    expect(typeof res.json().privacy_notice).toBe("string");
    expect(res.json().privacy_notice.length).toBeGreaterThan(10);

    const sensitive = await getUserSensitive(user);
    expect(sensitive.food_intolerances).toEqual([1, 2]);
    expect(sensitive.food_intolerance_notes).toBe("no nuts");
    expect(sensitive.dietary_data_state).toBe("present");
    expect(sensitive.shirt_size).toBe("L");

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT responses FROM application_responses WHERE user_id = $1 AND application_id = $2`,
      [user, appId],
    );
    expect(rows[0].responses).toEqual({ motivation: "x", credits: "yes", shirt_size: "L" });
  });

  it("keeps a genuinely unanswered dietary field distinct from lifecycle removal", async () => {
    const a = await getApp();
    const appId = await createApplication({ type: "participant" });
    const user = await createUser({ emailVerified: true });
    await saveDraft(a, appId, user, { motivation: "x" });

    const submitted = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [], food_intolerance_notes: null, shirt_size: "M" },
    });
    expect(submitted.statusCode).toBe(200);
    expect((await getUserSensitive(user)).dietary_data_state).toBe("not_provided");

    const response = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/response`,
      headers: asUser(user),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().dietary_data_state).toBe("not_provided");
  });

  it("M1: mirrors a DNI form answer onto users.dni (case-insensitive key)", async () => {
    const a = await getApp();
    const appId = await createApplication({
      type: "participant",
      template: [
        {
          key: "DNI",
          label: { en: "National ID", es: "DNI", gl: "DNI" },
          kind: "text",
          required: true,
        },
      ],
    });
    const user = await createUser({ emailVerified: true });
    await saveDraft(a, appId, user, { DNI: "12345678Z" });

    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [], shirt_size: "M" },
    });
    expect(res.statusCode).toBe(200);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT dni FROM users WHERE id = $1`, [user]);
    expect(rows[0].dni).toBe("12345678Z");
  });

  it("rejects editing a draft after it has been submitted", async () => {
    const a = await getApp();
    const appId = await createApplication({ type: "sponsor" });
    const user = await createUser({ emailVerified: true });
    await saveDraft(a, appId, user, { motivation: "x" });
    await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(user),
      payload: { food_intolerances: [] },
    });

    const res = await saveDraft(a, appId, user, { motivation: "changed" });
    expect(res.statusCode).toBe(409);
  });
});
