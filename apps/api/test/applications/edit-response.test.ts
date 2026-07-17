import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import type { TemplateField } from "../../src/modules/applications/schemas.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { createApplication, createResponse } from "./fixtures.js";

/**
 * Staff answer-editing (PUT /api/responses/:id, APPLICATIONS_EDIT_RESPONSE).
 * Regression: the edit validated against the ENRICHED template (shirt + dietary),
 * so it failed with "Response fails template validation" whenever those logistics
 * fields were blank — fields the answer-edit form doesn't even render. It must
 * validate only the form template staff actually edit.
 */

let app: App;
let editor: number;

const template: TemplateField[] = [
  { key: "field_1", label: { en: "Why", es: "", gl: "" }, kind: "text", required: false },
  { key: "field_7", label: { en: "Uni", es: "", gl: "" }, kind: "university", required: false },
  { key: "birthday", label: { en: "DOB", es: "", gl: "" }, kind: "date", required: false },
];

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  editor = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_EDIT_RESPONSE]);
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

async function editAnswers(responseId: number, responses: Record<string, unknown>) {
  const a = await getApp();
  return a.inject({
    method: "PUT",
    url: `/api/responses/${responseId}`,
    headers: asUser(editor),
    payload: { responses },
  });
}

describe("staff edit response", () => {
  it("edits a participant response even when shirt/dietary logistics are blank", async () => {
    const applicant = await createUser({ emailVerified: true });
    const appId = await createApplication({ type: "participant", template });
    const responseId = await createResponse(applicant, appId, {
      status: "review",
      responses: { field_1: "old", birthday: "2000-05-05" },
    });

    const res = await editAnswers(responseId, { field_1: "new", birthday: "2000-05-05" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).responses.field_1).toBe("new");
  });

  it("accepts a university id sent as a numeric string", async () => {
    const applicant = await createUser({ emailVerified: true });
    const { rows } = await pool.query(
      `INSERT INTO universities (name, proposed_by) VALUES ('Uni A', $1) RETURNING id`,
      [editor],
    );
    const uniId = rows[0].id as number;
    const appId = await createApplication({ type: "participant", template });
    const responseId = await createResponse(applicant, appId, {
      status: "review",
      responses: { field_7: uniId },
    });

    const res = await editAnswers(responseId, { field_1: "hi", field_7: String(uniId) });
    expect(res.statusCode).toBe(200);
  });

  it("does not let a staff edit reintroduce dietary response JSON", async () => {
    const applicant = await createUser({ emailVerified: true });
    const appId = await createApplication({ type: "participant", template });
    const responseId = await createResponse(applicant, appId, { status: "review" });

    const res = await editAnswers(responseId, {
      field_1: "kept",
      food_intolerances: [7],
      food_intolerance_notes: "must not be copied",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).responses).toEqual({ field_1: "kept" });
  });

  it("still rejects a value that violates the form template", async () => {
    const applicant = await createUser({ emailVerified: true });
    const numberTemplate: TemplateField[] = [
      { key: "age", label: { en: "Age", es: "", gl: "" }, kind: "number", required: false },
    ];
    const appId = await createApplication({ type: "participant", template: numberTemplate });
    const responseId = await createResponse(applicant, appId, {
      status: "review",
      responses: { age: 20 },
    });

    const res = await editAnswers(responseId, { age: "not-a-number" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toBe("Response fails template validation");
  });
});

describe("GET /api/public/universities?ids=", () => {
  it("resolves specific ids by name (even outside the alphabetical top page)", async () => {
    const a = await getApp();
    const proposer = await createUser({});
    const { rows } = await pool.query(
      `INSERT INTO universities (name, proposed_by)
       VALUES ('Zeta University', $1), ('Alpha University', $1) RETURNING id, name`,
      [proposer],
    );
    const zeta = rows.find((r: { name: string }) => r.name === "Zeta University");

    const res = await a.inject({ method: "GET", url: `/api/public/universities?ids=${zeta.id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.universities).toHaveLength(1);
    expect(body.universities[0]).toMatchObject({ id: zeta.id, name: "Zeta University" });
  });
});
