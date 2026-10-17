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
const template = [
  {
    key: "our_demo",
    kind: "text",
    label: { en: "Our demo", es: "Nuestra demo", gl: "A nosa demo" },
    required: false,
    project_video: true,
  },
  {
    key: "custom_technology",
    kind: "multiselect",
    label: { en: "Technology we tried", es: "Tecnología", gl: "Tecnoloxía" },
    required: true,
    options: [{ value: "ts", label: { en: "TypeScript", es: "TypeScript", gl: "TypeScript" } }],
  },
];
beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  owner = await createUser();
  await admitParticipant(owner);
  staff = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT, CAPABILITIES.EXPORTS_RUN]);
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
const define = (fields: object[]) =>
  app.inject({
    method: "PUT",
    url: "/api/projects/form",
    headers: asUser(staff),
    payload: { template: fields, sections: [] },
  });
it("saves exactly the organizer's questions, including deleting all questions (H16)", async () => {
  const result = await define(template);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().template).toEqual(template);
  const empty = await define([]);
  expect(empty.statusCode, empty.body).toBe(200);
  expect(empty.json().template).toEqual([]);
});
it("validates only configured required answers and video questions, independent of keys (H16/H20)", async () => {
  await define(template);
  const created = await app.inject({
    method: "POST",
    url: "/api/me/projects",
    headers: asUser(owner),
    payload: { name: "Reporting" },
  });
  const id = created.json().id;
  const draft = (responses: Record<string, unknown>, revision: number) =>
    app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses, revision },
    });
  const submit = () =>
    app.inject({ method: "POST", url: `/api/me/projects/${id}/submit`, headers: asUser(owner) });
  expect((await draft({}, 0)).statusCode).toBe(200);
  expect((await submit()).statusCode).toBe(400);
  await draft({ custom_technology: ["ts"], our_demo: "https://example.com/video" }, 1);
  expect((await submit()).statusCode).toBe(400);
  await draft({ custom_technology: ["ts"], our_demo: "https://youtu.be/abcdefghijk" }, 2);
  const result = await submit();
  expect(result.statusCode, result.body).toBe(200);
  await define([]);
  const csv = await app.inject({
    method: "GET",
    url: "/api/exports/projects.csv",
    headers: asUser(staff),
  });
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.body).toContain("Technology we tried");
  expect(csv.body).toContain("TypeScript");
  expect(csv.body).toContain("https://youtu.be/abcdefghijk");
});
it("exports configured columns and team details with authorization, formula protection and audit (H54)", async () => {
  await define([
    {
      key: "anything",
      kind: "textarea",
      label: { en: "Custom, question", es: "Pregunta", gl: "Pregunta" },
      required: false,
    },
  ]);
  const project = await app.inject({
    method: "POST",
    url: "/api/me/projects",
    headers: asUser(owner),
    payload: { name: "=1+1" },
  });
  await app.inject({
    method: "PUT",
    url: `/api/me/projects/${project.json().id}/draft`,
    headers: asUser(owner),
    payload: { responses: { anything: "A custom answer" }, revision: 0 },
  });
  expect(
    (await app.inject({ method: "GET", url: "/api/exports/projects.csv", headers: asUser(owner) }))
      .statusCode,
  ).toBe(403);
  const result = await app.inject({
    method: "GET",
    url: "/api/exports/projects.csv",
    headers: asUser(staff),
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.headers["cache-control"]).toBe("private, no-store");
  expect(result.body).toContain('"Custom, question"');
  expect(result.body).toContain("A custom answer");
  expect(result.body).toContain("Submitter First Name");
  expect(result.body).toContain("'=1+1");
  expect(result.body).not.toContain("GenAI");
  expect(
    (await pool.query(`SELECT count(*)::int n FROM audit_log WHERE entity_type='project_export'`))
      .rows[0].n,
  ).toBe(1);
});
