import "../applications/env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  ensureApplicationFormVersion,
  truncateAll,
} from "../helpers.js";

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("application fields integrated into Logistics", () => {
  it("returns an integrated field in the dashboard and aggregate CSV", async () => {
    const viewer = await createUserWithCapabilities([
      CAPABILITIES.LOGISTICS_STATS,
      CAPABILITIES.EXPORTS_RUN,
    ]);
    const applicant = await createUser();
    const template = [
      {
        key: "experience",
        kind: "select",
        label: { en: "Experience", es: "Experiencia", gl: "Experiencia" },
        options: [
          { value: "first", label: { en: "First", es: "Primera", gl: "Primeira" } },
          { value: "returning", label: { en: "Returning", es: "Repite", gl: "Repite" } },
        ],
        statistics: { enabled: true, visualization: "bar", aggregation: "count" },
      },
    ];
    const application = await pool.query<{ id: number }>(
      `INSERT INTO applications (name, type, template)
       VALUES ('Participants', 'participant', $1::jsonb) RETURNING id`,
      [JSON.stringify(template)],
    );
    const applicationId = application.rows[0]?.id;
    if (!applicationId) throw new Error("Application fixture was not created");
    const formVersionId = await ensureApplicationFormVersion(applicationId);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses, submitted_at)
       VALUES ($1, $2, $3, 'review', '{"experience":"first"}'::jsonb, now())`,
      [applicant, applicationId, formVersionId],
    );

    const query = await app.inject({
      method: "POST",
      url: "/api/statistics/query",
      headers: asUser(viewer),
      payload: { scopes: [`application:${applicationId}`] },
    });
    expect(query.statusCode).toBe(200);
    expect(query.json().panel_keys).toContain("field:experience");
    expect(query.json().field_distributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: expect.objectContaining({ key: "experience" }),
          buckets: [
            { value: "first", n: 1 },
            { value: "returning", n: 0 },
          ],
        }),
      ]),
    );

    const csv = await app.inject({
      method: "GET",
      url: `/api/exports/statistics.csv?scopes=application:${applicationId}`,
      headers: asUser(viewer),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("experience,first,1,100.0%");
    expect(csv.body).toContain("experience,returning,0,0.0%");
    expect(csv.body).toContain("applications-over-time");
  });
});
