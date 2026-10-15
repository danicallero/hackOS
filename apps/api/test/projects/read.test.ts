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
import {
  createChallenge,
  createEnterpriseChallenges,
  createRepoWithTeam,
  enqueueRepo,
} from "../queue/fixtures.js";
import { admitParticipant, setHackingWindow } from "./fixtures.js";

let app: App;
let reader: number;
let owner: number;
let id: number;
let challengeId: number;
beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  reader = await createUserWithCapabilities([
    CAPABILITIES.PROJECTS_READ,
    CAPABILITIES.PROJECTS_EDIT,
  ]);
  owner = await createUser();
  await admitParticipant(owner);
  id = (await createRepoWithTeam([owner], "One native project")).repoId;
  challengeId = await createChallenge();
  await pool.query(`UPDATE challenges SET visibility='visible' WHERE id=$1`, [challengeId]);
  await pool.query(`INSERT INTO project_challenges(repo_id,challenge_id) VALUES($1,$2)`, [
    id,
    challengeId,
  ]);
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
const get = (url: string, userId?: number) =>
  app.inject({ method: "GET", url, headers: userId ? asUser(userId) : {} });
describe("Native project read and scope (H18,H20,H46)", () => {
  it("staff detail contains single roster, intended challenge and working answers", async () => {
    const detail = await get(`/api/repos/${id}`, reader);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().members).toEqual([
      expect.objectContaining({ userId: owner, status: "active" }),
    ]);
    expect(detail.json().challenges).toEqual([expect.objectContaining({ id: challengeId })]);
    expect(detail.json()).not.toHaveProperty("source");
    expect(detail.body).not.toContain("reconciliation");
  });
  it("participant self view requires active membership and redacts teammate emails", async () => {
    const outsider = await createUser();
    expect((await get(`/api/me/projects/${id}`, outsider)).statusCode).toBe(404);
    const mine = await get("/api/me/projects", owner);
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json().projects[0].id).toBe(id);
    expect(mine.json().projects[0].members[0]).not.toHaveProperty("email");
    expect((await get("/api/me/projects")).statusCode).toBe(401);
  });
  it("pending invites grant neither detail access nor project list membership", async () => {
    const invited = await createUser();
    await pool.query(`INSERT INTO submissions(repo_id,user_id,status) VALUES($1,$2,'invited')`, [
      id,
      invited,
    ]);
    expect((await get(`/api/me/projects/${id}`, invited)).statusCode).toBe(404);
    expect((await get("/api/me/projects", invited)).json().projects).toEqual([]);
  });
  it("sponsor relationship stays inside enterprise project scope", async () => {
    const own = await createEnterpriseChallenges(1);
    const foreign = await createEnterpriseChallenges(1);
    await pool.query(`INSERT INTO project_challenges(repo_id,challenge_id) VALUES($1,$2)`, [
      id,
      own.challengeIds[0],
    ]);
    await enqueueRepo(own.challengeIds[0] as number, id, 1);
    const other = (await createRepoWithTeam()).repoId;
    await pool.query(`INSERT INTO project_challenges(repo_id,challenge_id) VALUES($1,$2)`, [
      other,
      foreign.challengeIds[0],
    ]);
    await enqueueRepo(foreign.challengeIds[0] as number, other, 1);
    const list = await get("/api/repos", own.repId);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().repos.map((r: { id: number }) => r.id)).toEqual([id]);
    expect((await get(`/api/repos/${other}`, own.repId)).statusCode).toBe(403);
  });
  it("withdrawal is audited and idempotent, mandatory entries cannot be withdrawn", async () => {
    await enqueueRepo(challengeId, id, 1);
    await pool.query(`UPDATE challenges SET mandatory=true WHERE id=$1`, [challengeId]);
    const url = `/api/me/projects/${id}/challenges/${challengeId}`;
    expect((await app.inject({ method: "DELETE", url, headers: asUser(owner) })).statusCode).toBe(
      409,
    );
    await pool.query(`UPDATE challenges SET mandatory=false WHERE id=$1`, [challengeId]);
    const headers = { ...asUser(owner), "idempotency-key": "withdraw-native" };
    const first = await app.inject({ method: "DELETE", url, headers });
    const again = await app.inject({ method: "DELETE", url, headers });
    expect(first.statusCode, first.body).toBe(200);
    expect(again.body).toBe(first.body);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM queue_history WHERE action='remove_from_challenge'`,
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("staff membership changes update queue authoritative roster", async () => {
    const added = await createUser();
    const response = await app.inject({
      method: "POST",
      url: `/api/repos/${id}/members`,
      headers: asUser(reader),
      payload: { userId: added },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      (await get(`/api/repos/${id}`, reader))
        .json()
        .members.map((m: { userId: number }) => m.userId),
    ).toContain(added);
    await app.inject({
      method: "DELETE",
      url: `/api/repos/${id}/members/${added}`,
      headers: asUser(reader),
    });
    expect(
      (await get(`/api/repos/${id}`, reader))
        .json()
        .members.map((m: { userId: number }) => m.userId),
    ).not.toContain(added);
  });
});
