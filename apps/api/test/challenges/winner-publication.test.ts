import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import { createChallenge, createRepoWithTeam } from "../queue/fixtures.js";

let app: App;
let admin: number;
let challengeId: number;
let repoId: number;
beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  admin = await createUserWithCapabilities([
    CAPABILITIES.CHALLENGES_MANAGE,
    CAPABILITIES.PROJECTS_READ,
  ]);
  challengeId = await createChallenge();
  repoId = (await createRepoWithTeam()).repoId;
  await pool.query(`UPDATE challenges SET visibility='visible' WHERE id=$1`, [challengeId]);
  await pool.query(`INSERT INTO project_challenges(repo_id,challenge_id) VALUES($1,$2)`, [
    repoId,
    challengeId,
  ]);
  await pool.query(
    `INSERT INTO event_config(id,project_gallery_opens_at,project_gallery_audience) VALUES(1,now()-interval '1 hour','public')`,
  );
  await pool.query(
    `INSERT INTO challenge_winners(challenge_id,rank,repo_id,set_by) VALUES($1,1,$2,$3)`,
    [challengeId, repoId, admin],
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
const surfaces = () => [
  "/api/public/challenges",
  `/api/public/challenges/${challengeId}/winners`,
  `/api/public/projects/${repoId}`,
  "/api/public/projects",
  "/api/tv/winners",
  "/api/tv/rooms",
];
describe("Winner publication H60", () => {
  it("omits every winner field before publication on all public read surfaces", async () => {
    for (const url of surfaces()) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body, url).not.toMatch(/"winners?"\s*:/);
    }
    const privateRead = await app.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}/winners`,
      headers: asUser(admin),
    });
    expect(privateRead.statusCode).toBe(200);
    expect(privateRead.json().winners).toHaveLength(1);
  });
  it("publishes due schedules once across concurrent publisher ticks with atomic audit", async () => {
    await pool.query(
      `UPDATE challenges SET winners_publish_at=now()-interval '1 second' WHERE id=$1`,
      [challengeId],
    );
    const { publishDueWinners } = await import(
      "../../src/modules/challenges/winner-publication.js"
    );
    const results = await Promise.all([publishDueWinners(), publishDueWinners()]);
    expect(results.flat()).toEqual([challengeId]);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM audit_log WHERE entity_type='challenge_winner_publication' AND action='scheduled_publish'`,
        )
      ).rows[0].n,
    ).toBe(1);
    for (const url of surfaces().filter((url) => url !== "/api/tv/rooms")) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body, url).toContain('"winners":');
    }
  });
  it("manual publication retries do not duplicate audit and audience still gates results", async () => {
    const url = `/api/challenges/${challengeId}/winners/publish`;
    const headers = { ...asUser(admin), "idempotency-key": "publish-once" };
    const first = await app.inject({ method: "POST", url, headers });
    const retry = await app.inject({ method: "POST", url, headers });
    expect(first.statusCode, first.body).toBe(200);
    expect(retry.body).toBe(first.body);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM audit_log WHERE entity_type='challenge_winner_publication' AND action='publish'`,
        )
      ).rows[0].n,
    ).toBe(1);
    await pool.query(`UPDATE event_config SET project_gallery_audience='staff'`);
    const result = await app.inject({ method: "GET", url: "/api/tv/winners" });
    expect(result.json()).toEqual({});
  });
  it("rejects past scheduling and does not reveal future schedules", async () => {
    const url = `/api/challenges/${challengeId}/winners/publication`;
    const past = await app.inject({
      method: "PUT",
      url,
      headers: asUser(admin),
      payload: { publishAt: new Date(Date.now() - 60000).toISOString() },
    });
    expect(past.statusCode).toBe(400);
    const future = await app.inject({
      method: "PUT",
      url,
      headers: asUser(admin),
      payload: { publishAt: new Date(Date.now() + 60000).toISOString() },
    });
    expect(future.statusCode, future.body).toBe(200);
    const { publishDueWinners } = await import(
      "../../src/modules/challenges/winner-publication.js"
    );
    expect(await publishDueWinners()).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/tv/winners" })).json()).toEqual({});
  });
});
