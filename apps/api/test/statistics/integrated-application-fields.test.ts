import "../applications/env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { accessibleStatisticsScopes } from "../../src/modules/statistics/service.js";
import {
  createApplication,
  createFoodIntolerance,
  createResponse,
} from "../applications/fixtures.js";
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
  it("derives age from a birth year using the event year", async () => {
    const viewer = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const applicant = await createUser();
    await pool.query(
      `INSERT INTO event_config (id, event_starts_at)
       VALUES (1, '2030-06-01T09:00:00Z')
       ON CONFLICT (id) DO UPDATE SET event_starts_at = EXCLUDED.event_starts_at`,
    );
    const template = [
      {
        key: "birth_year",
        kind: "birth_year",
        label: { en: "Birth year", es: "Año de nacimiento", gl: "Ano de nacemento" },
        statistics: { enabled: true, visualization: "bar", transformation: "age" },
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
       VALUES ($1, $2, $3, 'review', '{"birth_year":2000}'::jsonb, now())`,
      [applicant, applicationId, formVersionId],
    );

    const query = await app.inject({
      method: "POST",
      url: "/api/statistics/query",
      headers: asUser(viewer),
      payload: {
        scopes: [`application:${applicationId}`],
        participant_filter: "submitted",
      },
    });

    expect(query.statusCode).toBe(200);
    expect(query.json().field_distributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: expect.objectContaining({ key: "birth_year" }),
          buckets: [{ value: "30", n: 1 }],
        }),
      ]),
    );
  });

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

  it("filters form and logistics distributions while always excluding drafts", async () => {
    const viewer = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const confirmedUser = await createUser();
    const reviewUser = await createUser();
    const draftUser = await createUser();
    const nutFree = await createFoodIntolerance("Nut-free", viewer);
    const glutenFree = await createFoodIntolerance("Gluten-free", viewer);
    const template = [
      {
        key: "experience",
        kind: "select",
        label: { en: "Experience", es: "Experiencia", gl: "Experiencia" },
        options: [{ value: "first", label: { en: "First", es: "Primera", gl: "Primeira" } }],
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

    await createResponse(confirmedUser, applicationId, {
      status: "confirmed",
      responses: { experience: "first" },
    });
    await createResponse(reviewUser, applicationId, {
      status: "review",
      responses: { experience: "returning" },
    });
    await createResponse(draftUser, applicationId, {
      status: "draft",
      responses: { experience: "first" },
    });
    await pool.query(`UPDATE users SET shirt_size = $2, food_intolerances = $3 WHERE id = $1`, [
      confirmedUser,
      "M",
      [nutFree],
    ]);
    await pool.query(`UPDATE users SET shirt_size = $2, food_intolerances = $3 WHERE id = $1`, [
      reviewUser,
      "L",
      [glutenFree],
    ]);
    await pool.query(`UPDATE users SET shirt_size = $2, food_intolerances = $3 WHERE id = $1`, [
      draftUser,
      "S",
      [nutFree],
    ]);

    const queryStats = (participant_filter: "confirmed" | "submitted") =>
      app.inject({
        method: "POST",
        url: "/api/statistics/query",
        headers: asUser(viewer),
        payload: {
          scopes: [`application:${applicationId}`],
          panel_keys: ["field:experience", "shirt-sizes", "food-intolerances"],
          participant_filter,
        },
      });

    const confirmedOnly = await queryStats("confirmed");
    const allSubmitted = await queryStats("submitted");
    expect(confirmedOnly.statusCode).toBe(200);
    expect(allSubmitted.statusCode).toBe(200);

    type StatisticsResponse = {
      field_distributions: Array<{ buckets: Array<{ value: string; n: number }> }>;
      shirt_sizes_confirmed: Array<{ value: string; n: number }>;
      food_intolerances_confirmed: Array<{ intolerance_id: number; n: number }>;
    };
    const confirmedBody = confirmedOnly.json() as StatisticsResponse;
    const submittedBody = allSubmitted.json() as StatisticsResponse;
    const bucketsByMode = (body: StatisticsResponse) => {
      const distribution = body.field_distributions[0];
      return Object.fromEntries(
        (distribution?.buckets ?? []).map((bucket) => [bucket.value, bucket.n]),
      );
    };
    const shirtsByMode = (body: StatisticsResponse) =>
      Object.fromEntries(body.shirt_sizes_confirmed.map((row) => [row.value, row.n]));
    const intolerancesByMode = (body: StatisticsResponse) =>
      Object.fromEntries(
        body.food_intolerances_confirmed.map((row) => [row.intolerance_id, row.n]),
      );

    expect(bucketsByMode(confirmedBody)).toMatchObject({ first: 1 });
    expect(bucketsByMode(confirmedBody).returning).toBeUndefined();
    expect(bucketsByMode(submittedBody)).toMatchObject({ first: 1, returning: 1 });
    expect(shirtsByMode(confirmedBody)).toMatchObject({ M: 1 });
    expect(shirtsByMode(confirmedBody).L).toBeUndefined();
    expect(shirtsByMode(submittedBody)).toMatchObject({ M: 1, L: 1 });
    expect(shirtsByMode(submittedBody).S).toBeUndefined();
    expect(intolerancesByMode(confirmedBody)).toMatchObject({ [nutFree]: 1 });
    expect(intolerancesByMode(confirmedBody)[glutenFree]).toBeUndefined();
    expect(intolerancesByMode(submittedBody)).toMatchObject({
      [nutFree]: 1,
      [glutenFree]: 1,
    });
  });

  it("filters each application by multiple participant statuses and excludes drafts in queries and CSV", async () => {
    const viewer = await createUserWithCapabilities([
      CAPABILITIES.LOGISTICS_STATS,
      CAPABILITIES.EXPORTS_RUN,
    ]);
    const template = [
      {
        key: "experience",
        kind: "select",
        label: { en: "Experience", es: "Experiencia", gl: "Experiencia" },
        options: [
          ...["confirmed", "internal", "sent", "review", "draft", "other-review", "other-sent"].map(
            (value) => ({ value, label: { en: value, es: value, gl: value } }),
          ),
        ],
        statistics: { enabled: true, visualization: "bar", aggregation: "count" },
      },
    ];
    const firstApplicationId = await createApplication({
      name: "First participant form",
      type: "general",
      template,
    });
    const secondApplicationId = await createApplication({
      name: "Second participant form",
      type: "general",
      template,
    });
    const firstResponses = [
      { status: "confirmed", value: "confirmed", shirt: "M" },
      { status: "accepted_internal", value: "internal", shirt: "L" },
      { status: "accepted", value: "sent", shirt: "S" },
      { status: "review", value: "review", shirt: "XL" },
      { status: "draft", value: "draft", shirt: "XS" },
    ];
    const secondResponses = [
      { status: "review", value: "other-review", shirt: "XXL" },
      { status: "accepted", value: "other-sent", shirt: "XXXL" },
      { status: "draft", value: "draft", shirt: "XXS" },
    ];
    for (const response of firstResponses) {
      const userId = await createUser();
      await createResponse(userId, firstApplicationId, {
        status: response.status,
        responses: { experience: response.value },
      });
      await pool.query("UPDATE users SET shirt_size = $2 WHERE id = $1", [userId, response.shirt]);
    }
    for (const response of secondResponses) {
      const userId = await createUser();
      await createResponse(userId, secondApplicationId, {
        status: response.status,
        responses: { experience: response.value },
      });
      await pool.query("UPDATE users SET shirt_size = $2 WHERE id = $1", [userId, response.shirt]);
    }

    const scopes = [`application:${firstApplicationId}`, `application:${secondApplicationId}`];
    const participantFilters = {
      [`application:${firstApplicationId}`]: ["accepted_internal", "accepted"],
      [`application:${secondApplicationId}`]: [],
    };
    const query = await app.inject({
      method: "POST",
      url: "/api/statistics/query",
      headers: asUser(viewer),
      payload: {
        scopes,
        panel_keys: ["field:experience", "shirt-sizes"],
        participant_filters: participantFilters,
      },
    });

    expect(query.statusCode).toBe(200);
    const queryBody = query.json() as {
      field_distributions: Array<{ buckets: Array<{ value: string; n: number }> }>;
      shirt_sizes_confirmed: Array<{ value: string; n: number }>;
    };
    const experienceCounts = Object.fromEntries(
      (queryBody.field_distributions[0]?.buckets ?? []).map((bucket) => [bucket.value, bucket.n]),
    );
    const shirtCounts = Object.fromEntries(
      queryBody.shirt_sizes_confirmed.map((shirt) => [shirt.value, shirt.n]),
    );
    expect(experienceCounts).toMatchObject({
      internal: 1,
      sent: 1,
      "other-review": 1,
      "other-sent": 1,
      confirmed: 0,
      review: 0,
    });
    expect(experienceCounts.draft).toBe(0);
    expect(shirtCounts).toMatchObject({ L: 1, S: 1, XXL: 1, XXXL: 1 });
    expect(shirtCounts.M).toBeUndefined();
    expect(shirtCounts.XS).toBeUndefined();
    expect(shirtCounts.XXS).toBeUndefined();
    expect(shirtCounts.XL).toBeUndefined();

    const queryWithUnselectedApplicationFilter = await app.inject({
      method: "POST",
      url: "/api/statistics/query",
      headers: asUser(viewer),
      payload: {
        scopes: [`application:${firstApplicationId}`],
        participant_filters: { [`application:${secondApplicationId}`]: [] },
      },
    });
    expect(queryWithUnselectedApplicationFilter.statusCode).toBe(403);

    const exportParams = new URLSearchParams({
      scopes: scopes.join(","),
      panels: "field:experience,shirt-sizes",
      participant_filters: JSON.stringify(participantFilters),
    });
    const csv = await app.inject({
      method: "GET",
      url: `/api/exports/statistics.csv?${exportParams.toString()}`,
      headers: asUser(viewer),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("experience,internal,1,");
    expect(csv.body).toContain("experience,other-review,1,");
    expect(csv.body).toContain("experience,draft,0,");
    expect(csv.body).toContain("shirt-sizes,XXXL,1,");
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
      payload: {
        scopes: [`application:${applicationId}`],
        participant_filter: "submitted",
      },
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
      url: `/api/exports/statistics.csv?scopes=application:${applicationId}&participant_filter=submitted`,
      headers: asUser(viewer),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("experience,first,1,100.0%");
    expect(csv.body).toContain("experience,returning,0,0.0%");
    expect(csv.body).toContain("applications-over-time");
  });
});
