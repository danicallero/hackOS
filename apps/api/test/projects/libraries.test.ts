import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { admitParticipant, setHackingWindow } from "./fixtures.js";

let app: App;
let owner: number;
let staff: number;
let libraryId: string;
let field: Record<string, unknown>;
beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  owner = await createUser();
  await admitParticipant(owner);
  staff = await createUserWithCapabilities([
    CAPABILITIES.PROJECTS_EDIT,
    CAPABILITIES.APPLICATIONS_MANAGE,
  ]);
  await setHackingWindow(true);
  const form = await app.inject({
    method: "PUT",
    url: "/api/projects/form",
    headers: asUser(staff),
    payload: {
      template: [
        {
          key: "tech",
          kind: "library",
          required: false,
          label: { en: "Technology", es: "Tecnología", gl: "Tecnoloxía" },
        },
      ],
      sections: [],
    },
  });
  expect(form.statusCode, form.body).toBe(200);
  field = form.json().template[0];
  libraryId = String(field.library_id);
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
const propose = (name: string) =>
  app.inject({
    method: "POST",
    url: `/api/form-libraries/${libraryId}/proposals`,
    headers: asUser(owner),
    payload: { name },
  });
const manage = (payload: object, user = staff) =>
  app.inject({
    method: "POST",
    url: `/api/projects/form/libraries/${libraryId}/manage`,
    headers: asUser(user),
    payload,
  });
it("accepts more than one proposal per person and serializes equivalent concurrent names (H11/H16)", async () => {
  const duplicates = await Promise.all([propose(" React "), propose("react")]);
  expect(duplicates.every((result) => result.statusCode === 200)).toBe(true);
  expect(duplicates[0].json().id).toBe(duplicates[1].json().id);
  for (let i = 0; i < 12; i++) expect((await propose(`Technology ${i}`)).statusCode).toBe(200);
  expect(
    (
      await pool.query(`SELECT count(*)::int n FROM form_library_values WHERE library_id=$1`, [
        libraryId,
      ])
    ).rows[0].n,
  ).toBe(13);
  expect((await manage({ deleteIds: [duplicates[0].json().id] }, owner)).statusCode).toBe(403);
});
it("renames, merges and deletes working values while preserving a submitted snapshot (H16/H53)", async () => {
  const react = (await propose("React")).json();
  const js = (await propose("Javascript")).json();
  const project = (
    await app.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(owner),
      payload: { name: "Library project" },
    })
  ).json();
  await app.inject({
    method: "PUT",
    url: `/api/me/projects/${project.id}/draft`,
    headers: asUser(owner),
    payload: { responses: { tech: ["React", "Javascript"] }, revision: 0 },
  });
  const submitted = await app.inject({
    method: "POST",
    url: `/api/me/projects/${project.id}/submit`,
    headers: asUser(owner),
  });
  expect(submitted.statusCode, submitted.body).toBe(200);
  const curated = await manage({
    renames: [{ id: js.id, name: "JavaScript" }],
    merge: { sourceIds: [react.id], targetId: js.id },
  });
  expect(curated.statusCode, curated.body).toBe(200);
  expect(
    (await pool.query(`SELECT responses->'tech' AS values FROM repos WHERE id=$1`, [project.id]))
      .rows[0].values,
  ).toEqual(["JavaScript"]);
  expect(
    (
      await pool.query(
        `SELECT snapshot->'project'->'responses'->'tech' AS values FROM project_submission_versions WHERE repo_id=$1`,
        [project.id],
      )
    ).rows[0].values,
  ).toEqual(["React", "Javascript"]);
  expect((await manage({ deleteIds: [js.id] })).statusCode).toBe(200);
  expect(
    (await pool.query(`SELECT responses->'tech' AS values FROM repos WHERE id=$1`, [project.id]))
      .rows[0].values,
  ).toEqual([]);
});
it("requires explicit field-library deletion and cascades every value atomically (H11/H16)", async () => {
  await propose("React");
  const save = (ack?: string[]) =>
    app.inject({
      method: "PUT",
      url: "/api/projects/form",
      headers: asUser(staff),
      payload: { template: [], sections: [], ...(ack ? { library_deletions: ack } : {}) },
    });
  expect((await save()).statusCode).toBe(409);
  expect(
    (
      await pool.query(`SELECT count(*)::int n FROM form_library_values WHERE library_id=$1`, [
        libraryId,
      ])
    ).rows[0].n,
  ).toBe(1);
  expect((await save([libraryId])).statusCode).toBe(200);
  expect(
    (
      await pool.query(`SELECT count(*)::int n FROM form_library_values WHERE library_id=$1`, [
        libraryId,
      ])
    ).rows[0].n,
  ).toBe(0);
  expect(
    (await pool.query(`SELECT id FROM form_libraries WHERE id=$1`, [libraryId])).rowCount,
  ).toBe(0);
});

it("keeps application libraries scoped and cascades them when their form is deleted (H11)", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/applications",
    headers: asUser(staff),
    payload: {
      name: "Applications",
      template: [
        {
          key: "stack",
          kind: "library",
          required: false,
          label: { en: "Stack", es: "Tecnologías", gl: "Tecnoloxías" },
        },
      ],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id;
  const application = (await pool.query(`SELECT template FROM applications WHERE id=$1`, [id]))
    .rows[0];
  const catalogue = application.template[0].library_id;
  const proposed = await app.inject({
    method: "POST",
    url: `/api/form-libraries/${catalogue}/proposals`,
    headers: asUser(owner),
    payload: { name: "Python" },
  });
  expect(proposed.statusCode, proposed.body).toBe(200);
  const wrong = await app.inject({
    method: "POST",
    url: `/api/applications/${id}/libraries/${libraryId}/manage`,
    headers: asUser(staff),
    payload: { deleteIds: [proposed.json().id] },
  });
  expect(wrong.statusCode).toBe(404);
  const removed = await app.inject({
    method: "DELETE",
    url: `/api/applications/${id}`,
    headers: asUser(staff),
  });
  expect(removed.statusCode, removed.body).toBe(204);
  expect(
    (await pool.query(`SELECT id FROM form_libraries WHERE id=$1`, [catalogue])).rowCount,
  ).toBe(0);
  expect(
    (await pool.query(`SELECT id FROM form_library_values WHERE library_id=$1`, [catalogue]))
      .rowCount,
  ).toBe(0);
});
it("keeps synthetic catalogue values and working answers outside real curation (H16)", async () => {
  const real = (await propose("React")).json();
  const synthetic = await createUser();
  await pool.query(`UPDATE users SET is_test_account=true WHERE id=$1`, [synthetic]);
  const fake = await app.inject({
    method: "POST",
    url: `/api/form-libraries/${libraryId}/proposals`,
    headers: asUser(synthetic),
    payload: { name: "React" },
  });
  expect(fake.statusCode, fake.body).toBe(200);
  expect(fake.json().id).not.toBe(real.id);
  const repo = (
    await pool.query(
      `INSERT INTO repos(name,created_by,is_test_account,responses) VALUES('Synthetic',$1,true,'{"tech":["React"]}') RETURNING id`,
      [synthetic],
    )
  ).rows[0].id;
  expect((await manage({ renames: [{ id: real.id, name: "React.js" }] })).statusCode).toBe(200);
  expect(
    (await pool.query(`SELECT responses->'tech' AS values FROM repos WHERE id=$1`, [repo])).rows[0]
      .values,
  ).toEqual(["React"]);
  expect(
    (await pool.query(`SELECT name FROM form_library_values WHERE id=$1`, [fake.json().id])).rows[0]
      .name,
  ).toBe("React");
});

it("retiring a required application library keeps existing drafts submittable (H11/H12)", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/applications",
    headers: asUser(staff),
    payload: {
      name: "Application",
      template: [
        {
          key: "stack",
          kind: "library",
          required: true,
          label: { en: "Stack", es: "Tecnologías", gl: "Tecnoloxías" },
        },
      ],
    },
  });
  const id = created.json().id;
  const library = (await pool.query(`SELECT template FROM applications WHERE id=$1`, [id])).rows[0]
    .template[0].library_id;
  await app.inject({
    method: "POST",
    url: `/api/form-libraries/${library}/proposals`,
    headers: asUser(owner),
    payload: { name: "Rust" },
  });
  const draft = await app.inject({
    method: "PUT",
    url: `/api/applications/${id}/response`,
    headers: asUser(owner),
    payload: { responses: { stack: ["Rust"] } },
  });
  expect(draft.statusCode, draft.body).toBe(200);
  const changed = await app.inject({
    method: "PATCH",
    url: `/api/applications/${id}`,
    headers: asUser(staff),
    payload: { template: [], sections: [], library_deletions: [library] },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  const read = await app.inject({
    method: "GET",
    url: `/api/applications/${id}/response`,
    headers: asUser(owner),
  });
  expect(read.statusCode, read.body).toBe(200);
  expect(read.json().template).toEqual([]);
  expect(read.json().responses).toEqual({});
  const submitted = await app.inject({
    method: "POST",
    url: `/api/applications/${id}/response/submit`,
    headers: asUser(owner),
    payload: { responses: {} },
  });
  expect(submitted.statusCode, submitted.body).toBe(200);
});
