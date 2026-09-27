import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

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

describe("degree directory", () => {
  it("merges a duplicate into one row, preserves every stored answer, and audits the result (#846)", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);
    const applicant = await createUser();
    const secondApplicant = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    const { rows: degrees } = await pool.query(
      `INSERT INTO university_degrees (name, proposed_by)
       VALUES ('Computer Engineering', $1), ('Computer Eng.', $1)
       RETURNING id, name`,
      [manager],
    );
    const source = degrees.find((degree) => degree.name === "Computer Eng.")!;
    const target = degrees.find((degree) => degree.name === "Computer Engineering")!;
    const template = [
      { key: "degree", kind: "degree", label: { en: "Degree" } },
      { key: "minor_degree", kind: "degree", label: { en: "Minor degree" } },
    ];
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, template) VALUES ('Form', $1::jsonb) RETURNING id`,
      [JSON.stringify(template)],
    );
    const { rows: versions } = await pool.query(
      `INSERT INTO application_form_versions (application_id, version, template)
       VALUES ($1, 1, $2::jsonb) RETURNING id`,
      [applications[0].id, JSON.stringify(template)],
    );
    const { rows: responses } = await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, responses)
       VALUES
         ($1, $3, $4, $5::jsonb),
         ($2, $3, $4, $6::jsonb)
       RETURNING id`,
      [
        applicant,
        secondApplicant,
        applications[0].id,
        versions[0].id,
        JSON.stringify({ degree: source.id, minor_degree: target.id, note: "kept" }),
        JSON.stringify({ degree: String(source.id) }),
      ],
    );

    const merged = await a.inject({
      method: "POST",
      url: `/api/degrees/${source.id}/normalize`,
      headers: asUser(manager),
      payload: { targetId: target.id },
    });

    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toMatchObject({
      degree: { id: target.id },
      mergedDegreeId: source.id,
      applicationResponsesUpdated: 2,
    });
    const stored = await pool.query(
      `SELECT id, responses FROM application_responses WHERE id = ANY($1) ORDER BY id`,
      [responses.map((response) => response.id)],
    );
    expect(stored.rows.map((response) => response.responses)).toEqual([
      { degree: target.id, minor_degree: target.id, note: "kept" },
      { degree: target.id },
    ]);
    expect(
      await pool.query(`SELECT 1 FROM university_degrees WHERE id = $1`, [source.id]),
    ).toMatchObject({ rowCount: 0 });
    const audit = await pool.query(
      `SELECT actor_id, entity_type, entity_id, action, after
         FROM audit_log
        WHERE entity_type = 'university_degree' AND action = 'normalized'`,
    );
    expect(audit.rows).toEqual([
      {
        actor_id: manager,
        entity_type: "university_degree",
        entity_id: String(target.id),
        action: "normalized",
        after: { mergedDegreeId: source.id, applicationResponsesUpdated: 2 },
      },
    ]);
  });

  it("requires degree-library management and rejects unsafe merge targets", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);
    const unprivileged = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    const { rows: degrees } = await pool.query(
      `INSERT INTO university_degrees (name, proposed_by)
       VALUES ('Source degree', $1), ('Target degree', $1)
       RETURNING id, name`,
      [manager],
    );
    const source = degrees.find((degree) => degree.name === "Source degree")!;
    const target = degrees.find((degree) => degree.name === "Target degree")!;

    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/degrees/${source.id}/normalize`,
          headers: asUser(unprivileged),
          payload: { targetId: target.id },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/degrees/${source.id}/normalize`,
          headers: asUser(manager),
          payload: { targetId: source.id },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/degrees/${source.id}/normalize`,
          headers: asUser(manager),
          payload: { targetId: 999999 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      await pool.query(`SELECT id FROM university_degrees WHERE id = ANY($1)`, [
        [source.id, target.id],
      ]),
    ).toMatchObject({ rowCount: 2 });
  });
});
