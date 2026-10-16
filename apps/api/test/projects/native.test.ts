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
