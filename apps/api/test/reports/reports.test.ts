import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { invalidateSharedCache } from "../../src/lib/shared-cache.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { admitParticipant, setHackingWindow } from "../projects/fixtures.js";

/** H18: attendees report user-generated content; organisers close the reports. */

let app: App;
let owner: number;
let reporter: number;
let outsider: number;
let projectId: number;

beforeEach(async () => {
  await truncateAll();
  await invalidateSharedCache("gallery");
  app ??= await buildTestApp();
  owner = await createUser({ name: "Owner" });
  reporter = await createUser({ name: "Reporter" });
  outsider = await createUser();
  await admitParticipant(owner);
  await admitParticipant(reporter);
  await setHackingWindow(true);
  await pool.query(`INSERT INTO project_form_versions(template) VALUES('[]')`);
  projectId = (
    await app.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(owner),
      payload: { name: "Reported project" },
    })
  ).json().id;
  // Drafts are readable by every attendee.
  await pool.query(`UPDATE event_config SET project_draft_visibility='attendees'`);
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

function report(user: number, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/reports",
    headers: { ...asUser(user), "idempotency-key": crypto.randomUUID() },
    payload,
  });
}
const inbox = (user: number, status = "open") =>
  app.inject({
    method: "GET",
    url: `/api/content-reports?status=${status}`,
    headers: asUser(user),
  });
const save = (readerId: number, targetId: number) =>
  pool.query(`INSERT INTO diary_entries (owner_id, target_user_id) VALUES ($1, $2)`, [
    readerId,
    targetId,
  ]);

describe("filing a report", () => {
  it("files a project report once and returns the open one when repeated", async () => {
    const first = await report(reporter, { projectId, reason: "spam", details: " junk " });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("open");
    const again = await report(reporter, { projectId, reason: "harassment" });
    expect(again.json().id).toBe(first.json().id);
    const { rows } = await pool.query(`SELECT reason, details FROM content_reports`);
    expect(rows).toEqual([{ reason: "spam", details: "junk" }]);
  });

  it("refuses reporting your own project or yourself", async () => {
    expect((await report(owner, { projectId, reason: "other" })).statusCode).toBe(400);
    expect((await report(owner, { userId: owner, reason: "other" })).statusCode).toBe(400);
  });

  it("answers 404 for a project the reporter cannot see and 403 without event access", async () => {
    await pool.query(`UPDATE event_config SET project_draft_visibility='team_only'`);
    expect((await report(reporter, { projectId, reason: "spam" })).statusCode).toBe(404);
    expect((await report(outsider, { projectId, reason: "spam" })).statusCode).toBe(403);
  });

  it("lets an attendee report only a person they saved", async () => {
    expect((await report(reporter, { userId: owner, reason: "inappropriate" })).statusCode).toBe(
      404,
    );
    await save(reporter, owner);
    expect((await report(reporter, { userId: owner, reason: "inappropriate" })).statusCode).toBe(
      200,
    );
  });

  it("needs exactly one target and caps open reports", async () => {
    expect((await report(reporter, { reason: "spam" })).statusCode).toBe(400);
    expect((await report(reporter, { projectId, userId: owner, reason: "spam" })).statusCode).toBe(
      400,
    );
    for (let n = 0; n < 10; n += 1) {
      const target = await createUser();
      await save(reporter, target);
      expect((await report(reporter, { userId: target, reason: "other" })).statusCode).toBe(200);
    }
    expect((await report(reporter, { projectId, reason: "spam" })).statusCode).toBe(429);
  });
});

describe("the organiser inbox", () => {
  it("shows each moderator only the kinds their capability covers", async () => {
    await save(reporter, owner);
    await report(reporter, { projectId, reason: "spam" });
    await report(reporter, { userId: owner, reason: "harassment", details: "rude bio" });
    const projectsModerator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const usersModerator = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const both = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.USERS_WRITE,
    ]);

    const projects = (await inbox(projectsModerator)).json().items;
    expect(projects.map((item: { kind: string }) => item.kind)).toEqual(["project"]);
    expect(projects[0].project).toEqual({ id: projectId, name: "Reported project" });
    const people = (await inbox(usersModerator)).json().items;
    expect(people.map((item: { kind: string }) => item.kind)).toEqual(["profile"]);
    expect(people[0]).toMatchObject({ reason: "harassment", details: "rude bio" });
    expect((await inbox(both)).json().items).toHaveLength(2);
    expect((await inbox(reporter)).statusCode).toBe(403);
  });

  it("closes a report with an audit row and refuses to close it twice", async () => {
    const filed = (await report(reporter, { projectId, reason: "spam" })).json();
    const moderator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const close = (status: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/content-reports/${filed.id}`,
        headers: { ...asUser(moderator), "idempotency-key": crypto.randomUUID() },
        payload: { status, note: "fixed the description" },
      });
    expect((await close("actioned")).statusCode).toBe(200);
    expect((await close("dismissed")).statusCode).toBe(409);
    const { rows } = await pool.query(
      `SELECT action, reason FROM audit_log WHERE entity_type = 'content_report'`,
    );
    expect(rows).toEqual([{ action: "content_report.actioned", reason: "fixed the description" }]);
    expect((await inbox(moderator)).json().items).toEqual([]);
    expect((await inbox(moderator, "actioned")).json().items[0].status).toBe("actioned");
  });

  it("hides a report outside the moderator's kinds", async () => {
    const filed = (await report(reporter, { projectId, reason: "spam" })).json();
    const usersModerator = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/content-reports/${filed.id}`,
      headers: { ...asUser(usersModerator), "idempotency-key": crypto.randomUUID() },
      payload: { status: "dismissed" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("drops a project's reports with the project", async () => {
    await report(reporter, { projectId, reason: "spam" });
    await pool.query(`DELETE FROM project_challenges WHERE repo_id = $1`, [projectId]);
    await pool.query(`DELETE FROM submissions WHERE repo_id = $1`, [projectId]);
    await pool.query(`DELETE FROM repos WHERE id = $1`, [projectId]);
    expect((await pool.query(`SELECT 1 FROM content_reports`)).rowCount).toBe(0);
  });
});
