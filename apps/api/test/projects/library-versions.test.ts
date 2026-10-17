import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

let app: App;
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
it("curates draft library answers by immutable field identity after a key rename (H11/H12)", async () => {
  await truncateAll();
  app = await buildTestApp();
  const staff = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
  const owner = await createUser();
  const submittedOwner = await createUser();
  const created = await app.inject({
    method: "POST",
    url: "/api/applications",
    headers: asUser(staff),
    payload: {
      name: "Applications",
      template: [
        {
          key: "tech",
          kind: "library",
          required: true,
          label: { en: "Stack", es: "Tecnologías", gl: "Tecnoloxías" },
        },
      ],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id;
  const field = (await pool.query(`SELECT template FROM applications WHERE id=$1`, [id])).rows[0]
    .template[0];
  const entry = (
    await app.inject({
      method: "POST",
      url: `/api/form-libraries/${field.library_id}/proposals`,
      headers: asUser(owner),
      payload: { name: "JS" },
    })
  ).json();
  for (const user of [owner, submittedOwner]) {
    const saved = await app.inject({
      method: "PUT",
      url: `/api/applications/${id}/response`,
      headers: asUser(user),
      payload: { responses: { tech: ["JS"] } },
    });
    expect(saved.statusCode, saved.body).toBe(200);
  }
  const submitted = await app.inject({
    method: "POST",
    url: `/api/applications/${id}/response/submit`,
    headers: asUser(submittedOwner),
    payload: {},
  });
  expect(submitted.statusCode, submitted.body).toBe(200);
  const renamed = await app.inject({
    method: "PATCH",
    url: `/api/applications/${id}`,
    headers: asUser(staff),
    payload: {
      template: [{ ...field, key: "stack" }],
      field_renames: [{ from: "tech", to: "stack" }],
    },
  });
  expect(renamed.statusCode, renamed.body).toBe(200);
  const curated = await app.inject({
    method: "POST",
    url: `/api/applications/${id}/libraries/${field.library_id}/manage`,
    headers: asUser(staff),
    payload: { renames: [{ id: entry.id, name: "JavaScript" }] },
  });
  expect(curated.statusCode, curated.body).toBe(200);
  expect(
    (
      await pool.query(
        `SELECT responses->'stack' AS values FROM application_responses WHERE user_id=$1 AND application_id=$2`,
        [owner, id],
      )
    ).rows[0].values,
  ).toEqual(["JavaScript"]);
  expect(
    (
      await pool.query(
        `SELECT responses->'tech' AS values FROM application_responses WHERE user_id=$1 AND application_id=$2`,
        [submittedOwner, id],
      )
    ).rows[0].values,
  ).toEqual(["JS"]);
});
