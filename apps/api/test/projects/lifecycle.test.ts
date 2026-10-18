import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
let admin: number;
beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  owner = await createUser();
  await admitParticipant(owner);
  admin = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
  await setHackingWindow(true);
  await pool.query(
    `INSERT INTO project_form_versions(template) VALUES('[{"key":"description","kind":"textarea","label":{"en":"Description","es":"Descripción","gl":"Descrición"},"required":true}]')`,
  );
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
async function create() {
  const r = await app.inject({
    method: "POST",
    url: "/api/me/projects",
    headers: asUser(owner),
    payload: { name: "Native project" },
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as number;
}
describe("Native lifecycle (#1006,#1007,H20)", () => {
  it("creates one draft and submits same ID with immutable form snapshot", async () => {
    const id = await create();
    expect((await pool.query(`SELECT count(*)::int AS n FROM repos`)).rows[0].n).toBe(1);
    const invalid = await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    expect(invalid.statusCode).toBe(400);
    const save = await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { description: "Built here" }, revision: 0 },
    });
    expect(save.statusCode, save.body).toBe(200);
    const submitted = await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().id).toBe(id);
    const snapshot = (
      await pool.query(
        `SELECT snapshot,form_version_id FROM project_submission_versions WHERE repo_id=$1`,
        [id],
      )
    ).rows[0];
    expect(snapshot.form_version_id).toBeTruthy();
    expect(snapshot.snapshot.project.responses.description).toBe("Built here");
  });
  it("requires a linked GitHub repository when the event asks for it (H18)", async () => {
    await pool.query(`UPDATE event_config SET project_github_required=true WHERE id=1`);
    const id = await create();
    await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { description: "Built here" }, revision: 0 },
    });
    const submit = () =>
      app.inject({
        method: "POST",
        url: `/api/me/projects/${id}/submit`,
        headers: asUser(owner),
      });
    const refused = await submit();
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details.code).toBe("project_github_required");
    // Staff can enter the repository by hand.
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/repos/${id}`,
      headers: asUser(admin),
      payload: { githubUrl: "https://github.com/team/project" },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect((await submit()).statusCode).toBe(200);
  });
  it("lets staff return a submitted project to the team and drops a replaced App link (H21)", async () => {
    const id = await create();
    await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { description: "Built here" }, revision: 0 },
    });
    await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    await pool.query(
      `INSERT INTO github_repo_links (repo_id, installation_id, github_repo_id, full_name) VALUES ($1, 9, 1, 'team/old')`,
      [id],
    );
    const frozen = await app.inject({
      method: "DELETE",
      url: `/api/me/projects/${id}/github`,
      headers: asUser(owner),
    });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().error.details.code).toBe("project_frozen");
    const returned = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/unlock`,
      headers: asUser(admin),
      payload: { reason: "Wrong repository", decision: "unlock" },
    });
    expect(returned.statusCode, returned.body).toBe(200);
    const unlinked = await app.inject({
      method: "DELETE",
      url: `/api/me/projects/${id}/github`,
      headers: asUser(owner),
    });
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    await pool.query(
      `INSERT INTO github_repo_links (repo_id, installation_id, github_repo_id, full_name) VALUES ($1, 9, 1, 'team/old')`,
      [id],
    );
    await app.inject({
      method: "PATCH",
      url: `/api/repos/${id}`,
      headers: asUser(admin),
      payload: { githubUrl: "https://github.com/team/new" },
    });
    expect(
      (await pool.query(`SELECT 1 FROM github_repo_links WHERE repo_id=$1`, [id])).rowCount,
    ).toBe(0);
  });
  it("serializes concurrent autosaves and rejects stale revision", async () => {
    const id = await create();
    const results = await Promise.all(
      ["one", "two"].map((description) =>
        app.inject({
          method: "PUT",
          url: `/api/me/projects/${id}/draft`,
          headers: asUser(owner),
          payload: { responses: { description }, revision: 0 },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (await pool.query(`SELECT draft_revision FROM repos WHERE id=$1`, [id])).rows[0]
        .draft_revision,
    ).toBe(1);
  });
  it("rejects participant edits after submit while retaining the submission", async () => {
    const id = await create();
    await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { description: "Submitted" }, revision: 0 },
    });
    await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    const edit = await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { description: "Too late" }, revision: 1 },
    });
    expect(edit.statusCode, edit.body).toBe(409);
    expect(
      (await pool.query(`SELECT snapshot FROM project_submission_versions WHERE repo_id=$1`, [id]))
        .rows[0].snapshot.project.responses.description,
    ).toBe("Submitted");
  });
  it("hides team-only drafts and closed galleries", async () => {
    const id = await create();
    const detail = await app.inject({ method: "GET", url: `/api/public/projects/${id}` });
    expect(detail.statusCode).toBe(404);
    const list = await app.inject({ method: "GET", url: "/api/public/projects" });
    expect(list.statusCode).toBe(403);
    const own = await app.inject({
      method: "GET",
      url: `/api/me/projects/${id}`,
      headers: asUser(owner),
    });
    expect(own.statusCode, own.body).toBe(200);
  });
  it("creates audited form versions", async () => {
    const result = await app.inject({
      method: "PUT",
      url: "/api/projects/form",
      headers: asUser(admin),
      payload: { template: [], sections: [] },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM audit_log WHERE entity_type='project_form'`,
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
