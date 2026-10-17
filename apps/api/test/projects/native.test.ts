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
import { createChallenge } from "../queue/fixtures.js";
import { admitParticipant, setHackingWindow } from "./fixtures.js";

let app: App;
let staff: number;
let participant: number;
let challengeId: number;
beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  staff = await createUserWithCapabilities([
    CAPABILITIES.PROJECTS_EDIT,
    CAPABILITIES.PROJECTS_READ,
  ]);
  participant = await createUser();
  await admitParticipant(participant);
  challengeId = await createChallenge();
  await pool.query(`UPDATE challenges SET visibility='visible' WHERE id=$1`, [challengeId]);
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
describe("Native creation and correction (H19-H21)", () => {
  it("participant draft records challenge intent without queue entries", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(participant),
      payload: { name: "Draft", challengeIds: [challengeId] },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(
      (await pool.query(`SELECT submission_status FROM repos WHERE id=$1`, [r.json().id])).rows[0]
        .submission_status,
    ).toBe("draft");
    expect((await pool.query(`SELECT count(*)::int AS n FROM queue_entries`)).rows[0].n).toBe(0);
    expect(
      (
        await pool.query(`SELECT challenge_id FROM project_challenges WHERE repo_id=$1`, [
          r.json().id,
        ])
      ).rows[0].challenge_id,
    ).toBe(challengeId);
  });
  it("participant creation requires admission and open phase", async () => {
    const outsider = await createUser();
    const create = (userId: number) =>
      app.inject({
        method: "POST",
        url: "/api/me/projects",
        headers: asUser(userId),
        payload: { name: "Draft" },
      });
    expect((await create(outsider)).statusCode).toBe(403);
    await setHackingWindow(false);
    expect((await create(participant)).statusCode).toBe(403);
    expect(
      (
        await app.inject({ method: "GET", url: "/api/me/projects", headers: asUser(participant) })
      ).json().canCreate,
    ).toBe(false);
  });
  it("hidden or unknown challenge cannot be selected and creation rolls back", async () => {
    await pool.query(`UPDATE challenges SET visibility='hidden' WHERE id=$1`, [challengeId]);
    const r = await app.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(participant),
      payload: { name: "Draft", challengeIds: [challengeId] },
    });
    expect(r.statusCode).toBe(404);
    expect((await pool.query(`SELECT count(*)::int AS n FROM repos`)).rows[0].n).toBe(0);
  });
  it("staff creation writes roster, intent and one queue history per challenge atomically", async () => {
    const create = () =>
      app.inject({
        method: "POST",
        url: "/api/repos",
        headers: { ...asUser(staff), "idempotency-key": "staff-create" },
        payload: {
          name: "Staff project",
          memberUserIds: [participant],
          challengeIds: [challengeId],
        },
      });
    const first = await create();
    const again = await create();
    expect(first.statusCode, first.body).toBe(200);
    expect(again.body).toBe(first.body);
    const id = first.json().id;
    expect(
      (await pool.query(`SELECT repo_id FROM submissions WHERE user_id=$1`, [participant])).rows[0]
        .repo_id,
    ).toBe(id);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM queue_history WHERE action='enqueue'`))
        .rows[0].n,
    ).toBe(1);
  });
  it("invalid staff member produces explicit not-found and no partial project", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/repos",
      headers: asUser(staff),
      payload: { name: "Invalid", memberUserIds: [999999] },
    });
    expect(r.statusCode, r.body).toBe(404);
    expect((await pool.query(`SELECT count(*)::int AS n FROM repos`)).rows[0].n).toBe(0);
  });
  it("staff answer corrections bypass phase but retain optimistic concurrency and audit", async () => {
    const id = (
      await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: asUser(staff),
        payload: { name: "Correct" },
      })
    ).json().id;
    await setHackingWindow(false);
    const r = await app.inject({
      method: "PUT",
      url: `/api/repos/${id}/draft`,
      headers: asUser(staff),
      payload: { responses: { description: "Staff correction" }, revision: 0 },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().revision).toBe(1);
    const stale = await app.inject({
      method: "PUT",
      url: `/api/repos/${id}/draft`,
      headers: asUser(staff),
      payload: { responses: {}, revision: 0 },
    });
    expect(stale.statusCode).toBe(409);
  });
});

it("administration creates another team's project with dynamic answers, never self-enrolling", async () => {
  const template = [
    {
      key: "summary",
      kind: "textarea",
      required: true,
      project_description: true,
      label: { en: "Summary", es: "Resumen", gl: "Resumo" },
    },
  ];
  await pool.query(`INSERT INTO project_form_versions(template) VALUES($1)`, [
    JSON.stringify(template),
  ]);
  await setHackingWindow(false);
  const result = await app.inject({
    method: "POST",
    url: "/api/repos",
    headers: asUser(staff),
    payload: {
      name: "Team project",
      memberUserIds: [participant],
      responses: { summary: "Built by the selected team" },
    },
  });
  expect(result.statusCode, result.body).toBe(200);
  const id = result.json().id;
  const roster = await pool.query(`SELECT user_id FROM submissions WHERE repo_id=$1`, [id]);
  expect(roster.rows).toEqual([{ user_id: participant }]);
  const detail = await app.inject({
    method: "GET",
    url: `/api/repos/${id}`,
    headers: asUser(staff),
  });
  expect(detail.json().responses.summary).toBe("Built by the selected team");
  expect(detail.json().description).toBe("Built by the selected team");
});

it("explicit staff enrollment appends a draft to an existing queue while judging is running", async () => {
  const first = await app.inject({
    method: "POST",
    url: "/api/repos",
    headers: asUser(staff),
    payload: { name: "First", memberUserIds: [participant], challengeIds: [challengeId] },
  });
  expect(first.statusCode, first.body).toBe(200);
  const draft = await app.inject({
    method: "POST",
    url: "/api/me/projects",
    headers: asUser(participant),
    payload: { name: "Late draft" },
  });
  expect(draft.statusCode, draft.body).toBe(200);
  await setHackingWindow(false);
  await pool.query(
    `INSERT INTO queue_settings(id,schedule_start_at,schedule_end_at) VALUES(1,now()-interval '1 hour',now()+interval '1 hour') ON CONFLICT(id) DO UPDATE SET schedule_start_at=excluded.schedule_start_at,schedule_end_at=excluded.schedule_end_at`,
  );
  const id = draft.json().id;
  const enter = () =>
    app.inject({
      method: "POST",
      url: `/api/repos/${id}/challenges`,
      headers: asUser(staff),
      payload: { challengeId },
    });
  const result = await enter();
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().inserted).toBe(true);
  expect(result.json().entry.position).toBe(2);
  expect((await enter()).json().inserted).toBe(false);
  const eligibility = await pool.query(
    `SELECT r.submission_status,e.eligible FROM repos r JOIN project_eligibility e ON e.repo_id=r.id WHERE r.id=$1`,
    [id],
  );
  expect(eligibility.rows[0]).toMatchObject({ submission_status: "draft", eligible: false });
  expect(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM queue_entries WHERE repo_id=$1 AND challenge_id=$2`,
        [id, challengeId],
      )
    ).rows[0].n,
  ).toBe(1);
});

it("staff corrections and roster changes cannot cross the fixture boundary", async () => {
  const fixture = (
    await pool.query(
      `INSERT INTO repos(name,is_test_account) VALUES('Fixture only',true) RETURNING id`,
    )
  ).rows[0].id;
  const requests = [
    { method: "PATCH" as const, url: `/api/repos/${fixture}`, payload: { name: "Changed" } },
    {
      method: "PUT" as const,
      url: `/api/repos/${fixture}/draft`,
      payload: { responses: { note: "Changed" }, revision: 0 },
    },
    {
      method: "POST" as const,
      url: `/api/repos/${fixture}/members`,
      payload: { userId: participant },
    },
    { method: "DELETE" as const, url: `/api/repos/${fixture}/members/${participant}` },
  ];
  for (const request of requests) {
    const result = await app.inject({ ...request, headers: asUser(staff) });
    expect(result.statusCode, result.body).toBe(404);
  }
  const row = (
    await pool.query(`SELECT name,responses,draft_revision FROM repos WHERE id=$1`, [fixture])
  ).rows[0];
  expect(row).toEqual({ name: "Fixture only", responses: {}, draft_revision: 0 });
});
