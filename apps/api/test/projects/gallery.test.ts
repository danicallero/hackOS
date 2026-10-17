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
let attendee: number;
let outsider: number;
let staff: number;
let id: number;
beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  owner = await createUser();
  attendee = await createUser();
  outsider = await createUser();
  staff = await createUserWithCapabilities([CAPABILITIES.PROJECTS_READ, CAPABILITIES.EVENT_MANAGE]);
  await admitParticipant(owner);
  await admitParticipant(attendee);
  await setHackingWindow(true);
  await pool.query(`INSERT INTO project_form_versions(template) VALUES('[]')`);
  id = (
    await app.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(owner),
      payload: { name: "Gallery project" },
    })
  ).json().id;
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
function get(path: string, user?: number) {
  return app.inject({ method: "GET", url: path, headers: user ? asUser(user) : {} });
}
describe("Gallery phase/consent/snapshot policy (#1008,#1009)", () => {
  it.each([
    "team_only",
    "attendees",
    "public",
  ])("gates draft detail for %s visibility", async (visibility) => {
    await pool.query(`UPDATE event_config SET project_draft_visibility=$1`, [visibility]);
    expect((await get(`/api/public/projects/${id}`)).statusCode).toBe(
      visibility === "public" ? 200 : 404,
    );
    expect((await get(`/api/public/projects/${id}`, attendee)).statusCode).toBe(
      visibility === "team_only" ? 404 : 200,
    );
    expect((await get(`/api/me/projects/${id}`, owner)).statusCode).toBe(200);
    await pool.query(`UPDATE event_config SET project_drafts_open_at=now()+interval '1 hour'`);
    expect((await get(`/api/public/projects/${id}`, attendee)).statusCode).toBe(404);
  });
  it.each([
    "staff",
    "attendees",
    "public",
  ])("gates submitted gallery list and detail for %s audience", async (audience) => {
    await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    await pool.query(
      `UPDATE event_config SET project_gallery_opens_at=now()-interval '1 second',project_gallery_audience=$1`,
      [audience],
    );
    expect((await get("/api/public/projects")).statusCode).toBe(audience === "public" ? 200 : 403);
    expect((await get("/api/public/projects", attendee)).statusCode).toBe(
      audience === "staff" ? 403 : 200,
    );
    expect((await get("/api/public/projects", outsider)).statusCode).toBe(
      audience === "public" ? 200 : 403,
    );
    expect((await get("/api/public/projects", staff)).statusCode).toBe(200);
    await pool.query(`UPDATE event_config SET project_gallery_opens_at=now()+interval '1 hour'`);
    const early = await get("/api/public/projects", audience === "staff" ? outsider : attendee);
    expect(early.statusCode).toBe(403);
    // H18: say why, so clients show "opens on …" rather than a permission error.
    expect(early.json().error.details.reason).toBe(
      audience === "staff" ? "gallery_audience" : "gallery_closed",
    );
    if (audience !== "staff")
      expect(early.json().error.details.opensAt).toEqual(expect.any(String));
    // Project staff review the gallery before it opens.
    expect((await get("/api/public/projects", staff)).statusCode).toBe(200);
    await pool.query(`UPDATE event_config SET project_gallery_opens_at=NULL`);
    expect((await get("/api/public/projects", staff)).statusCode).toBe(200);
  });
  it("keeps last submitted answers and template for public while team sees newer working draft", async () => {
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
    await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { description: "Working" }, revision: 1 },
    });
    await pool.query(
      `INSERT INTO project_form_versions(template) VALUES('[{"key":"new","kind":"text","label":{"en":"New","es":"Nueva","gl":"Nova"}}]')`,
    );
    await pool.query(
      `UPDATE event_config SET project_gallery_opens_at=now()-interval '1 second',project_gallery_audience='public'`,
    );
    const publicDetail = (await get(`/api/public/projects/${id}`)).json();
    expect(publicDetail.responses.description).toBe("Submitted");
    expect((await get(`/api/public/projects/${id}`, owner)).json().responses.description).toBe(
      "Submitted",
    );
    expect(publicDetail.template).toEqual([]);
    const own = (await get(`/api/me/projects/${id}`, owner)).json();
    expect(own.responses.description).toBe("Working");
    expect(own.hasUnsubmittedChanges).toBe(true);
    expect(publicDetail.hasUnsubmittedChanges).toBe(false);
    expect(own.template[0].key).toBe("new");
  });
  it("applies current name consent to public list and detail while retaining team names", async () => {
    await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    await pool.query(
      `UPDATE event_config SET project_gallery_opens_at=now()-interval '1 second',project_gallery_audience='public'`,
    );
    for (const showName of [false, true, false]) {
      await pool.query(`UPDATE users SET gallery_show_name=$2 WHERE id=$1`, [owner, showName]);
      for (const viewer of [undefined, attendee, outsider]) {
        const detailResponse = await get(`/api/public/projects/${id}`, viewer);
        const listResponse = await get("/api/public/projects", viewer);
        expect(detailResponse.headers["cache-control"]).toBe("no-store");
        expect(listResponse.headers["cache-control"]).toBe("no-store");
        const detail = detailResponse.json();
        const list = listResponse.json();
        for (const project of [detail, list.items[0]]) {
          expect(project.members[0].name).toBe(showName ? "Test User" : null);
          expect(project.members[0].surname).toBeNull();
        }
      }
      const own = (await get(`/api/me/projects/${id}`, owner)).json();
      expect(own.members[0].name).toBe("Test User");
    }
  });
  it("shows a member photo exactly when the public profile shares it (H18, #934)", async () => {
    await pool.query(`UPDATE event_config SET project_draft_visibility='public'`);
    await pool.query(
      `UPDATE users SET photo_key='profiles/'||id||'/photo/'||repeat('a',32)||'.jpg',photo_updated_at=now() WHERE id=$1`,
      [owner],
    );
    const photoUrl = async () =>
      (await get(`/api/public/projects/${id}`)).json().members[0].photoUrl;
    expect(await photoUrl()).toBeNull();
    // A visible profile that hides its photo still hides it on projects.
    await pool.query(
      `INSERT INTO user_public_profiles(user_id,directory_visible,show_photo,consented_at) VALUES($1,true,false,now())`,
      [owner],
    );
    expect(await photoUrl()).toBeNull();
    await pool.query(`UPDATE user_public_profiles SET show_photo=true WHERE user_id=$1`, [owner]);
    expect(await photoUrl()).toContain(`/members/${owner}/photo`);
    // Hiding the whole profile hides the photo too, including the photo route.
    await pool.query(`UPDATE user_public_profiles SET directory_visible=false WHERE user_id=$1`, [
      owner,
    ]);
    expect(await photoUrl()).toBeNull();
    expect((await get(`/api/public/projects/${id}/members/${owner}/photo`)).statusCode).toBe(404);
    expect((await get("/api/me/project-gallery-consent", owner)).statusCode).toBe(404);
  });
  it("separates editing lock from submission close", async () => {
    await pool.query(
      `UPDATE event_config SET project_submissions_close_at=now()-interval '1 second',project_edits_lock_at=now()+interval '1 hour'`,
    );
    const own = (await get(`/api/me/projects/${id}`, owner)).json();
    expect(own.canEdit).toBe(true);
    expect(own.canSubmit).toBe(false);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/me/projects/${id}/submit`,
          headers: asUser(owner),
        })
      ).statusCode,
    ).toBe(403);
  });
  it("paginates and rejects excessive page size", async () => {
    await pool.query(
      `UPDATE event_config SET project_gallery_opens_at=now()-interval '1 second',project_gallery_audience='public',project_draft_visibility='public'`,
    );
    for (let i = 0; i < 3; i++)
      await app.inject({
        method: "POST",
        url: "/api/me/projects",
        headers: asUser(owner),
        payload: { name: `Project ${i}` },
      });
    const first = (await get("/api/public/projects?pageSize=2")).json();
    const second = (await get("/api/public/projects?pageSize=2&page=2")).json();
    expect(first.total).toBe(4);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.items.map((p: { id: number }) => p.id)).not.toEqual(
      second.items.map((p: { id: number }) => p.id),
    );
    expect((await get("/api/public/projects?pageSize=10000")).statusCode).toBe(400);
  });
});

it("member edit flags honor organizer locks and approved post-deadline reopening", async () => {
  await pool.query(`UPDATE repos SET lock_reason='organizer_lock' WHERE id=$1`, [id]);
  const locked = await get(`/api/me/projects/${id}`, owner);
  expect(locked.json()).toMatchObject({ canEdit: false, canSubmit: false });
  await setHackingWindow(false);
  await pool.query(
    `UPDATE repos SET lock_reason=NULL,submission_status='draft',submitted_at=now() WHERE id=$1`,
    [id],
  );
  const reopened = await get(`/api/me/projects/${id}`, owner);
  expect(reopened.json()).toMatchObject({ canEdit: true, canSubmit: true });
});

it("staff corrections publish a new version without rewriting the participant's submission", async () => {
  const editor = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
  await app.inject({
    method: "PUT",
    url: `/api/me/projects/${id}/draft`,
    headers: asUser(owner),
    payload: { responses: { summary: "Original" }, revision: 0 },
  });
  await app.inject({
    method: "POST",
    url: `/api/me/projects/${id}/submit`,
    headers: asUser(owner),
  });
  await setHackingWindow(false);
  const corrected = await app.inject({
    method: "PUT",
    url: `/api/repos/${id}/draft`,
    headers: asUser(editor),
    payload: { responses: { summary: "Corrected" }, revision: 1 },
  });
  expect(corrected.statusCode, corrected.body).toBe(200);
  await pool.query(
    `UPDATE event_config SET project_gallery_opens_at=now()-interval '1 second',project_gallery_audience='public'`,
  );
  expect((await get(`/api/public/projects/${id}`)).json().responses.summary).toBe("Corrected");
  const versions = await pool.query(
    `SELECT source,snapshot->'project'->'responses'->>'summary' AS summary FROM project_submission_versions WHERE repo_id=$1 ORDER BY id`,
    [id],
  );
  expect(versions.rows).toEqual([
    { source: "native", summary: "Original" },
    { source: "admin", summary: "Corrected" },
  ]);
});

it("keeps hidden challenges out of public project details while retaining staff inspection", async () => {
  const { createChallenge } = await import("../queue/fixtures.js");
  const challengeId = await createChallenge();
  await pool.query(`INSERT INTO project_challenges(repo_id,challenge_id) VALUES($1,$2)`, [
    id,
    challengeId,
  ]);
  await pool.query(`UPDATE event_config SET project_draft_visibility='public'`);
  expect((await get(`/api/public/projects/${id}`)).json().challenges).toEqual([]);
  expect((await get(`/api/me/projects/${id}`, owner)).json().challenges[0].id).toBe(challengeId);
  expect((await get(`/api/repos/${id}`, staff)).json().challenges[0].id).toBe(challengeId);
});
