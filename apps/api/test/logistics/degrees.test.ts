import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import {
  asUser,
  createUser,
  createUserWithCapabilities,
  ensureApplicationFormVersion,
  useTestApp,
} from "../helpers.js";

const getApp = useTestApp();

describe("degree directory", () => {
  it("searches names without accents while preserving stored spelling (H12)", async () => {
    const app = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      "INSERT INTO university_degrees (name) VALUES ($1), ($2) RETURNING id, name",
      ["Ingeniería Informática", "Unrelated catalogue entry"],
    );
    for (const q of [
      "INGENIERIA",
      "Ingeniería Informática",
      "Ingeniería Informática".normalize("NFD"),
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/public/degrees?q=${encodeURIComponent(q)}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().degrees).toEqual([rows[0]]);
    }
    const missing = await app.inject({ method: "GET", url: "/api/public/degrees?q=no-match" });
    expect(missing.json().degrees).toEqual([]);
    const byId = await app.inject({ method: "GET", url: `/api/public/degrees?ids=${rows[0].id}` });
    expect(byId.json().degrees).toEqual([rows[0]]);
  });

  for (const status of ["draft", "review"] as const) {
    it(`rejects deleting a degree still used by a ${status} response (H12)`, async () => {
      const a = await getApp();
      const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);
      const applicant = await createUser();
      const { pool } = await import("../../src/db/pool.js");
      const { rows: degrees } = await pool.query(
        `INSERT INTO university_degrees (name) VALUES ('Computer Engineering') RETURNING id`,
      );
      const degreeId = degrees[0].id;
      const { rows: applications } = await pool.query(
        `INSERT INTO applications (name, template) VALUES ('Form', $1::jsonb) RETURNING id`,
        [JSON.stringify([{ key: "degree_name", kind: "degree", label: { en: "Studies" } }])],
      );
      const applicationId = applications[0].id;
      const versionId = await ensureApplicationFormVersion(applicationId);
      await pool.query(
        `INSERT INTO application_responses
           (user_id, application_id, application_form_version_id, status, responses)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [applicant, applicationId, versionId, status, JSON.stringify({ degree_name: degreeId })],
      );
      // H12: deletion also protects answers from an older immutable form version.
      await pool.query(`UPDATE applications SET template = '[]'::jsonb WHERE id = $1`, [
        applicationId,
      ]);

      const rejected = await a.inject({
        method: "DELETE",
        url: `/api/degrees/${degreeId}`,
        headers: asUser(manager),
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().error.details).toMatchObject({ code: "degree_in_use" });
      expect(
        (await pool.query(`SELECT 1 FROM university_degrees WHERE id = $1`, [degreeId])).rowCount,
      ).toBe(1);
      expect(
        (
          await pool.query(
            `SELECT 1 FROM audit_log WHERE entity_type = 'university_degree' AND entity_id = $1 AND action = 'deleted'`,
            [String(degreeId)],
          )
        ).rowCount,
      ).toBe(0);

      await pool.query(`DELETE FROM application_responses WHERE user_id = $1`, [applicant]);
      const deleted = await a.inject({
        method: "DELETE",
        url: `/api/degrees/${degreeId}`,
        headers: asUser(manager),
      });
      expect(deleted.statusCode).toBe(204);
      expect(
        (await pool.query(`SELECT 1 FROM university_degrees WHERE id = $1`, [degreeId])).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            `SELECT 1 FROM audit_log WHERE entity_type = 'university_degree' AND entity_id = $1 AND action = 'deleted'`,
            [String(degreeId)],
          )
        ).rowCount,
      ).toBe(1);
    });
  }

  it("deletes a degree proposer with a draft while preserving another applicant's degree (H54)", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const proposer = await createUser();
    const other = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    const { rows: degrees } = await pool.query(
      `INSERT INTO university_degrees (name, proposed_by, suggested_by) VALUES ('Computer Engineering', $1, $1) RETURNING id`,
      [proposer],
    );
    const degreeId = degrees[0].id;
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, template) VALUES ('Form', $1::jsonb) RETURNING id`,
      [
        JSON.stringify([
          {
            key: "degree_name",
            kind: "degree",
            label: { en: "Studies" },
            statistics: { enabled: true },
          },
        ]),
      ],
    );
    const applicationId = applications[0].id;
    const versionId = await ensureApplicationFormVersion(applicationId);
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $3, $4, 'draft', $5::jsonb), ($2, $3, $4, 'review', $5::jsonb)`,
      [proposer, other, applicationId, versionId, JSON.stringify({ degree_name: degreeId })],
    );
    const result = await a.inject({
      method: "DELETE",
      url: `/api/users/${proposer}`,
      headers: asUser(admin),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ deleted: true });
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [proposer])).rowCount).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM application_responses WHERE user_id = $1`, [proposer]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(`SELECT proposed_by, suggested_by FROM university_degrees WHERE id = $1`, [
          degreeId,
        ])
      ).rows,
    ).toEqual([{ proposed_by: null, suggested_by: null }]);
    expect(
      (await pool.query(`SELECT responses FROM application_responses WHERE user_id = $1`, [other]))
        .rows,
    ).toEqual([{ responses: { degree_name: degreeId } }]);
    const stats = await a.inject({
      method: "POST",
      url: "/api/statistics/query",
      headers: asUser(admin),
      payload: { scopes: [`application:${applicationId}`], participant_filter: "submitted" },
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().field_distributions[0].buckets).toEqual([
      { value: "Computer Engineering", n: 1 },
    ]);
  });

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
