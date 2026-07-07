import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  createChallenge,
  EMAILS,
  participantsCsv,
  projectsCsv,
  seedMatchableUsers,
} from "./fixtures.js";

/** PROJECTS_READ views + participant self-view + prize->challenge mapping. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

async function importFixtures(operator: number): Promise<void> {
  const server = await getApp();
  const res = await server.inject({
    method: "POST",
    url: "/api/devpost/imports/confirm",
    headers: asUser(operator),
    payload: { projectsCsv: projectsCsv(), participantsCsv: participantsCsv() },
  });
  expect(res.statusCode).toBe(200);
}

describe("GET /api/repos + /api/repos/:id (PROJECTS_READ)", () => {
  it("lists repos with members, prizes and challenges mapped via devpost_tags", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const challengeId = await createChallenge("AI Challenge", ["Best AI Hack"]);
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);

    const forbidden = await server.inject({
      method: "GET",
      url: "/api/repos",
      headers: asUser(await createUser()),
    });
    expect(forbidden.statusCode).toBe(403);

    const reader = await createUserWithCapabilities([CAPABILITIES.PROJECTS_READ]);
    const res = await server.inject({ method: "GET", url: "/api/repos", headers: asUser(reader) });
    expect(res.statusCode).toBe(200);
    const { repos } = res.json();
    expect(repos).toHaveLength(2);

    const beans = repos.find((r: { name: string }) => r.name === "Neural Beans");
    expect(beans.members).toHaveLength(3);
    expect(beans.prizes.sort()).toEqual(["Best AI Hack", "Most Caffeinated"]);
    expect(beans.challenges).toEqual([
      {
        id: challengeId,
        title: "AI Challenge",
        status: null,
        position: null,
        assignedRoomId: null,
        assignedRoomName: null,
        mappedPrizes: ["Best AI Hack"],
        source: "prize",
      },
    ]);
    expect(beans.unmappedPrizes).toEqual(["Most Caffeinated"]);

    const single = await server.inject({
      method: "GET",
      url: `/api/repos/${beans.id}`,
      headers: asUser(reader),
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().name).toBe("Neural Beans");
    expect(single.json().members).toHaveLength(3);

    const missing = await server.inject({
      method: "GET",
      url: "/api/repos/999999",
      headers: asUser(reader),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("shows directly-added queue challenges after Add to Challenge", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const challengeId = await createChallenge("Live Queue", []);
    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_IMPORT,
      CAPABILITIES.PROJECTS_READ,
      CAPABILITIES.PROJECTS_EDIT,
    ]);
    await importFixtures(operator);

    const repos = await server.inject({
      method: "GET",
      url: "/api/repos",
      headers: asUser(operator),
    });
    const beans = repos.json().repos.find((r: { name: string }) => r.name === "Neural Beans");

    const add = await server.inject({
      method: "POST",
      url: `/api/repos/${beans.id}/challenges`,
      headers: asUser(operator),
      payload: { challengeId },
    });
    expect(add.statusCode).toBe(200);

    const single = await server.inject({
      method: "GET",
      url: `/api/repos/${beans.id}`,
      headers: asUser(operator),
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().challenges).toContainEqual(
      expect.objectContaining({
        id: challengeId,
        title: "Live Queue",
        status: "waiting",
        mappedPrizes: [],
        source: "queue",
      }),
    );
  });

  it("removes an imported prize from a project", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_IMPORT,
      CAPABILITIES.PROJECTS_READ,
      CAPABILITIES.PROJECTS_EDIT,
    ]);
    await createChallenge("AI Challenge", ["Best AI Hack"]);
    await importFixtures(operator);

    const repos = await server.inject({
      method: "GET",
      url: "/api/repos",
      headers: asUser(operator),
    });
    const beans = repos.json().repos.find((r: { name: string }) => r.name === "Neural Beans");

    const remove = await server.inject({
      method: "DELETE",
      url: `/api/repos/${beans.id}/prizes/${encodeURIComponent("Most Caffeinated")}`,
      headers: asUser(operator),
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toEqual({ repoId: beans.id, prize: "Most Caffeinated", removed: true });

    const single = await server.inject({
      method: "GET",
      url: `/api/repos/${beans.id}`,
      headers: asUser(operator),
    });
    expect(single.json().prizes).toEqual(["Best AI Hack"]);
    expect(single.json().unmappedPrizes).toEqual([]);
  });
});

describe("GET /api/repos scoping for judges & sponsors (H8, H44/H46)", () => {
  /** Assign `judge` to judge `challengeId` via a room + room_judges row. */
  async function assignJudge(judge: number, challengeId: number): Promise<void> {
    const { pool } = await import("../../src/db/pool.js");
    const room = await pool.query(`INSERT INTO rooms (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Room ${crypto.randomUUID().slice(0, 8)}`,
      `room-${crypto.randomUUID()}`,
    ]);
    const roomId = room.rows[0].id;
    await pool.query(`INSERT INTO room_challenges (room_id, challenge_id) VALUES ($1, $2)`, [
      roomId,
      challengeId,
    ]);
    await pool.query(
      `INSERT INTO room_judges (room_id, challenge_id, user_id) VALUES ($1, $2, $3)`,
      [roomId, challengeId, judge],
    );
  }

  /** Enterprise + sponsor(user) + challenge authored by that sponsor. */
  async function createSponsorChallenge(
    sponsorUserId: number,
    title: string,
    devpostTags: string[],
  ): Promise<number> {
    const { pool } = await import("../../src/db/pool.js");
    const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
      `Ent ${crypto.randomUUID().slice(0, 8)}`,
    ]);
    const sponsor = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [enterprise.rows[0].id, sponsorUserId],
    );
    const challenge = await pool.query(
      `INSERT INTO challenges (author, title, devpost_tags) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [sponsor.rows[0].id, title, JSON.stringify(devpostTags)],
    );
    return challenge.rows[0].id;
  }

  it("a judge sees only repos of their assigned challenge; a full reader sees all", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);
    // "Most Caffeinated" maps only Neural Beans; "Best AI Hack" maps both repos.
    const caffeine = await createChallenge("Caffeine", ["Most Caffeinated"]);
    await createChallenge("AI", ["Best AI Hack"]);

    const judge = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
    await assignJudge(judge, caffeine);

    const judged = await server.inject({
      method: "GET",
      url: "/api/repos",
      headers: asUser(judge),
    });
    expect(judged.statusCode).toBe(200);
    const judgeRepos = judged.json().repos;
    expect(judgeRepos.map((x: { name: string }) => x.name)).toEqual(["Neural Beans"]);

    // Full projects:read reader still sees everything (2 repos).
    const reader = await createUserWithCapabilities([CAPABILITIES.PROJECTS_READ]);
    const all = await server.inject({ method: "GET", url: "/api/repos", headers: asUser(reader) });
    expect(all.json().repos).toHaveLength(2);
  });

  it("a judge with no assignments gets an empty list, not a 403", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);

    const judge = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
    const res = await server.inject({ method: "GET", url: "/api/repos", headers: asUser(judge) });
    expect(res.statusCode).toBe(200);
    expect(res.json().repos).toHaveLength(0);
  });

  it("a sponsor rep sees only their enterprise's challenges' repos", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);

    const sponsorUser = await createUser();
    await createSponsorChallenge(sponsorUser, "Sponsor Caffeine", ["Most Caffeinated"]);

    const res = await server.inject({
      method: "GET",
      url: "/api/repos",
      headers: asUser(sponsorUser),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().repos.map((x: { name: string }) => x.name)).toEqual(["Neural Beans"]);
  });

  it("a user with none of the three access modes is forbidden", async () => {
    const server = await getApp();
    const nobody = await createUser();
    const res = await server.inject({ method: "GET", url: "/api/repos", headers: asUser(nobody) });
    expect(res.statusCode).toBe(403);
  });

  it("scopes GET /api/repos/:id — out-of-scope repo is 404, not a leak", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);
    const caffeine = await createChallenge("Caffeine", ["Most Caffeinated"]);
    const judge = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
    await assignJudge(judge, caffeine);

    const reader = await createUserWithCapabilities([CAPABILITIES.PROJECTS_READ]);
    const all = await server.inject({ method: "GET", url: "/api/repos", headers: asUser(reader) });
    const beans = all.json().repos.find((x: { name: string }) => x.name === "Neural Beans");
    const rustacean = all
      .json()
      .repos.find((x: { name: string }) => x.name === "Rustacean Station");

    const inScope = await server.inject({
      method: "GET",
      url: `/api/repos/${beans.id}`,
      headers: asUser(judge),
    });
    expect(inScope.statusCode).toBe(200);
    expect(inScope.json().name).toBe("Neural Beans");

    const outOfScope = await server.inject({
      method: "GET",
      url: `/api/repos/${rustacean.id}`,
      headers: asUser(judge),
    });
    expect(outOfScope.statusCode).toBe(404);
  });
});

describe("GET /api/me/projects (participant self-view)", () => {
  it("returns only repos where I have a submission; requires auth", async () => {
    const server = await getApp();
    const { aliceId } = await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);

    const anon = await server.inject({ method: "GET", url: "/api/me/projects" });
    expect(anon.statusCode).toBe(401);

    const res = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(aliceId),
    });
    expect(res.statusCode).toBe(200);
    const { projects } = res.json();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Neural Beans");
    expect(projects[0].prizes.sort()).toEqual(["Best AI Hack", "Most Caffeinated"]);

    const stranger = await createUser();
    const empty = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(stranger),
    });
    expect(empty.json().projects).toHaveLength(0);
  });

  it("lets staff list projects for a selected user in the admin profile", async () => {
    const server = await getApp();
    const { aliceId, bobId } = await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);

    const pleb = await createUser();
    const forbidden = await server.inject({
      method: "GET",
      url: `/api/users/${aliceId}/projects`,
      headers: asUser(pleb),
    });
    expect(forbidden.statusCode).toBe(403);

    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const res = await server.inject({
      method: "GET",
      url: `/api/users/${aliceId}/projects`,
      headers: asUser(reader),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(1);
    expect(res.json().projects[0]).toMatchObject({
      name: "Neural Beans",
      prizes: ["Best AI Hack", "Most Caffeinated"],
    });

    const bob = await server.inject({
      method: "GET",
      url: `/api/users/${bobId}/projects`,
      headers: asUser(reader),
    });
    expect(bob.statusCode).toBe(200);
    expect(bob.json().projects.map((project: { name: string }) => project.name)).toEqual([
      "Neural Beans",
    ]);

    const missing = await server.inject({
      method: "GET",
      url: "/api/users/999999/projects",
      headers: asUser(reader),
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("POST /api/repos/:repoId/members (PROJECTS_EDIT)", () => {
  it("adds an existing internal user and returns them in project detail", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_IMPORT,
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.PROJECTS_READ,
    ]);
    await importFixtures(operator);

    const reposRes = await server.inject({
      method: "GET",
      url: "/api/repos",
      headers: asUser(operator),
    });
    const repo = reposRes.json().repos.find((r: { name: string }) => r.name === "Neural Beans");
    const member = await createUser({ email: "late-signup@test.local", name: "Late Signup" });

    const addRes = await server.inject({
      method: "POST",
      url: `/api/repos/${repo.id}/members`,
      headers: asUser(operator),
      payload: { userId: member },
    });
    expect(addRes.statusCode).toBe(200);
    expect(addRes.json()).toMatchObject({ repoId: repo.id, userId: member, inserted: true });

    const detail = await server.inject({
      method: "GET",
      url: `/api/repos/${repo.id}`,
      headers: asUser(operator),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: member,
          email: "late-signup@test.local",
          name: "Late Signup",
          mergeStatus: "manual",
        }),
      ]),
    );

    const mine = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(member),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().projects.map((p: { id: number }) => p.id)).toEqual([repo.id]);
  });
});

describe("POST /api/devpost/prizes/:prizeName/map", () => {
  it("appends the prize to challenges.devpost_tags and reports affected repos without enqueuing", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const challengeId = await createChallenge("Caffeine Challenge", []);
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);

    const res = await server.inject({
      method: "POST",
      url: `/api/devpost/prizes/${encodeURIComponent("Most Caffeinated")}/map`,
      headers: asUser(operator),
      payload: { challengeId },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.challengeId).toBe(challengeId);
    expect(result.prize).toBe("Most Caffeinated");
    expect(result.repoCount).toBe(1);
    expect(result.repoIds).toHaveLength(1);

    const { pool } = await import("../../src/db/pool.js");
    const challenge = await pool.query(`SELECT devpost_tags FROM challenges WHERE id = $1`, [
      challengeId,
    ]);
    expect(challenge.rows[0].devpost_tags).toEqual(["Most Caffeinated"]);

    // queue is NOT touched — that's the queue workstream's job
    const entries = await pool.query(`SELECT count(*)::int AS n FROM queue_entries`);
    expect(entries.rows[0].n).toBe(0);

    // idempotent: mapping again doesn't duplicate the tag
    const again = await server.inject({
      method: "POST",
      url: `/api/devpost/prizes/${encodeURIComponent("Most Caffeinated")}/map`,
      headers: asUser(operator),
      payload: { challengeId },
    });
    expect(again.statusCode).toBe(200);
    const after = await pool.query(`SELECT devpost_tags FROM challenges WHERE id = $1`, [
      challengeId,
    ]);
    expect(after.rows[0].devpost_tags).toEqual(["Most Caffeinated"]);

    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE action = 'map_devpost_prize'`,
    );
    expect(auditRows.rows).toHaveLength(2);

    // members with the fixture emails still line up (sanity on fixture reuse)
    expect(EMAILS.alice).toContain("@");
  });

  it("404s for a missing challenge", async () => {
    const server = await getApp();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    const res = await server.inject({
      method: "POST",
      url: `/api/devpost/prizes/${encodeURIComponent("Ghost Prize")}/map`,
      headers: asUser(operator),
      payload: { challengeId: 424242 },
    });
    expect(res.statusCode).toBe(404);
  });
});
