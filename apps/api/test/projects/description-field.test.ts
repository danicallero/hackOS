import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";
import { admitParticipant, setHackingWindow } from "./fixtures.js";

/** H16: the project form's description field is the project's description. */

let app: App;
let owner: number;
beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  owner = await createUser();
  await admitParticipant(owner);
  await setHackingWindow(true);
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function form(template: object[]) {
  await pool.query(`INSERT INTO project_form_versions(template) VALUES($1)`, [
    JSON.stringify(template),
  ]);
}
async function create() {
  const r = await app.inject({
    method: "POST",
    url: "/api/me/projects",
    headers: asUser(owner),
    payload: { name: "Vault" },
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as number;
}
const label = { en: "About", es: "Sobre", gl: "Sobre" };

describe("Project description field (H16)", () => {
  it("copies the marked field's answer into the project description", async () => {
    await form([{ key: "about", kind: "textarea", project_description: true, label }]);
    const id = await create();
    const save = await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { about: "  A local second brain.  " }, revision: 0 },
    });
    expect(save.statusCode, save.body).toBe(200);
    const { rows } = await pool.query(`SELECT description FROM repos WHERE id=$1`, [id]);
    expect(rows[0].description).toBe("A local second brain.");
  });

  it("fills an empty description field from an existing description, by key too", async () => {
    await form([{ key: "description", kind: "textarea", label }]);
    const id = await create();
    await pool.query(`UPDATE repos SET description='Imported text' WHERE id=$1`, [id]);
    const project = await app.inject({ url: `/api/me/projects/${id}`, headers: asUser(owner) });
    expect(project.json().responses.description).toBe("Imported text");
  });

  it("a field chosen later takes over answers given before it was the description", async () => {
    await form([{ key: "about", kind: "textarea", label }]);
    const id = await create();
    await pool.query(`UPDATE repos SET description='Old imported text' WHERE id=$1`, [id]);
    await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { about: "Answer written first" }, revision: 0 },
    });
    // Read path: the answer wins even before any resync.
    await form([{ key: "about", kind: "textarea", project_description: true, label }]);
    const list = await app.inject({ url: "/api/me/projects", headers: asUser(owner) });
    expect(list.json().projects[0].description).toBe("Answer written first");
    // Saving the form copies it into the stored column for every other reader.
    const { createUserWithCapabilities } = await import("../helpers.js");
    const { CAPABILITIES } = await import("@hackos/shared/capabilities");
    const staff = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const saved = await app.inject({
      method: "PUT",
      url: "/api/projects/form",
      headers: { ...asUser(staff), "idempotency-key": "form-1" },
      payload: {
        template: [{ key: "about", kind: "textarea", project_description: true, label }],
        sections: [],
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const { rows } = await pool.query(`SELECT description FROM repos WHERE id=$1`, [id]);
    expect(rows[0].description).toBe("Answer written first");
  });

  it("refuses two description fields and a non-text one", async () => {
    const { templateSchema } = await import("@hackos/shared/forms");
    expect(
      templateSchema.safeParse([
        { key: "a", kind: "text", project_description: true, label },
        { key: "b", kind: "textarea", project_description: true, label },
      ]).success,
    ).toBe(false);
    expect(
      templateSchema.safeParse([{ key: "a", kind: "file", project_description: true, label }])
        .success,
    ).toBe(false);
  });
});
