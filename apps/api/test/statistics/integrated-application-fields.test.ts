import "../applications/env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { accessibleStatisticsScopes } from "../../src/modules/statistics/service.js";
import {
  assignRole,
  asUser,
  authorizationContextFor,
  buildTestApp,
  createRole,
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
  it("resolves application and role scope ACLs with one bounded set query", async () => {
    const reader = await createUser();
    const readerRole = await createRole();
    await assignRole(reader, readerRole);
    const applicationIds: number[] = [];
    const roleIds: number[] = [];
    for (let index = 0; index < 24; index++) {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO applications (name, template) VALUES ($1, '[]'::jsonb) RETURNING id`,
        [`Scope ${index}`],
      );
      applicationIds.push(rows[0]?.id as number);
      roleIds.push(await createRole([], { name: `scope-role-${index}` }));
    }
    await pool.query(
      `INSERT INTO statistics_scope_panel_role_access (scope_key, panel_key, role_id, state)
       VALUES ($1, 'overview', $2, 'allow'), ($3, 'shirt-sizes', $2, 'allow')`,
      [`application:${applicationIds[0]}`, readerRole, `role:${roleIds[0]}`],
    );

    const context = await authorizationContextFor(reader);
    const querySpy = vi.spyOn(pool, "query");
    const scopes = await accessibleStatisticsScopes(reader, context);
    const aclQueries = querySpy.mock.calls.filter(([query]) => {
      return String(query).includes("statistics_scope_panel_role_access");
    });
    querySpy.mockRestore();

    expect(scopes.map((scope) => scope.key)).toEqual([
      `application:${applicationIds[0]}`,
      `role:${roleIds[0]}`,
    ]);
    expect(scopes[0]?.panelKeys).toEqual(["overview"]);
    expect(scopes[1]?.panelKeys).toEqual(["shirt-sizes"]);
    expect(aclQueries).toHaveLength(1);
  });

  it("accepts only the canonical field publication and generic endpoints", async () => {
    const manager = await createUserWithCapabilities([
      CAPABILITIES.STATISTICS_MANAGE,
      CAPABILITIES.APPLICATIONS_MANAGE,
    ]);
    const legacyField = {
      key: "experience",
      kind: "select",
      label: { en: "Experience", es: "Experiencia", gl: "Experiencia" },
      options: [{ value: "first", label: { en: "First", es: "Primera", gl: "Primeira" } }],
      reporting: true,
    };
    const rejected = await app.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "Legacy form", template: [legacyField] },
    });
    expect(rejected.statusCode).toBe(400);

    const removedForms = await app.inject({
      method: "GET",
      url: "/api/applications/stats/forms",
      headers: asUser(manager),
    });
    const removedDetail = await app.inject({
      method: "GET",
      url: "/api/applications/1/stats",
      headers: asUser(manager),
    });
    expect(removedForms.statusCode).toBe(404);
    expect(removedDetail.statusCode).toBe(404);
  });

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
      `INSERT INTO applications (name, template)
       VALUES ('Participants', $1::jsonb) RETURNING id`,
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
