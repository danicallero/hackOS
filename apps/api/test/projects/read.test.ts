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
import { createChallenge, createProject } from "./fixtures.js";

/** PROJECTS_READ views + participant self-view (H20, H21, #1006). */

let app: App;

beforeEach(async () => {
  await truncateAll();
  await pool.query(`UPDATE queue_settings SET schedule_start_at = NULL WHERE id = 1`);
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

interface SeededProjects {
  aliceId: number;
  bobId: number;
  carolId: number;
  beansId: number;
  rustaceanId: number;
  caffeineId: number;
  aiId: number;
}

/** Two projects: Neural Beans (Alice, Bob) entered in Caffeine and AI; Rustacean Station (Carol) in AI. */
async function seedProjects(): Promise<SeededProjects> {
  const aliceId = await createUser({ email: "alice@primary.test", name: "Alice" });
  const bobId = await createUser({ email: "bob@primary.test", name: "Bob" });
  const carolId = await createUser({ email: "carol@primary.test", name: "Carol" });
  const caffeineId = await createChallenge("Caffeine");
  const aiId = await createChallenge("AI Challenge");
  const beansId = await createProject([aliceId, bobId], {
    name: "Neural Beans",
    challengeIds: [caffeineId, aiId],
  });
  const rustaceanId = await createProject([carolId], {
    name: "Rustacean Station",
    challengeIds: [aiId],
  });
  return { aliceId, bobId, carolId, beansId, rustaceanId, caffeineId, aiId };
}

describe("GET /api/repos + /api/repos/:id (PROJECTS_READ)", () => {
  it("allows only active members to withdraw optional challenges before judging, idempotently", async () => {
    const server = await getApp();
    const owner = await createUser();
    const outsider = await createUser();
    const challengeId = await createChallenge("Optional");
    const repo = await createProject([owner], { name: "My project", challengeIds: [challengeId] });
    await pool.query(
      `INSERT INTO queue_entries(repo_id,challenge_id,status,position) VALUES($1,$2,'waiting',1)`,
      [repo, challengeId],
    );
    const url = `/api/me/projects/${repo}/challenges/${challengeId}`;
    expect(
      (await server.inject({ method: "DELETE", url, headers: asUser(outsider) })).statusCode,
    ).toBe(403);
    await pool.query(`UPDATE challenges SET mandatory=true WHERE id=$1`, [challengeId]);
    expect(
      (await server.inject({ method: "DELETE", url, headers: asUser(owner) })).statusCode,
    ).toBe(409);
    await pool.query(`UPDATE challenges SET mandatory=false WHERE id=$1`, [challengeId]);
    const headers = { ...asUser(owner), "idempotency-key": "self-withdraw" };
    const first = await server.inject({ method: "DELETE", url, headers });
    expect(first.statusCode).toBe(200);
    expect((await server.inject({ method: "DELETE", url, headers })).json()).toEqual(first.json());
    expect(
      (await pool.query(`SELECT * FROM queue_history WHERE action='remove_from_challenge'`))
        .rowCount,
    ).toBe(1);
    const beforeSchedule = await pool.query(
      `SELECT schedule_start_at FROM queue_settings WHERE id=1`,
    );
    await pool.query(
      `INSERT INTO queue_settings(id,schedule_start_at) VALUES(1,now()-interval '1 minute') ON CONFLICT(id) DO UPDATE SET schedule_start_at=EXCLUDED.schedule_start_at`,
    );
    try {
      expect(
        (await server.inject({ method: "DELETE", url, headers: asUser(owner) })).statusCode,
      ).toBe(403);
    } finally {
      await pool.query(`UPDATE queue_settings SET schedule_start_at=$1 WHERE id=1`, [
        beforeSchedule.rows[0]?.schedule_start_at ?? null,
      ]);
    }
  });
  it("projects logical queue rank, ETA and every possible room", async () => {
    const server = await getApp();
    const challengeId = await createChallenge("Presentation");
    const first = await createProject([], { name: "First" });
    const second = await createProject([], { name: "Second" });
    await pool.query(
      `INSERT INTO queue_entries(repo_id,challenge_id,status,position) VALUES($1,$3,'waiting',10),($2,$3,'waiting',20)`,
      [first, second, challengeId],
    );
    const rooms = await pool.query(
      `INSERT INTO rooms(name) VALUES ('Room A'),('Room B') RETURNING id`,
    );
    for (const room of rooms.rows) {
      await pool.query(
        `INSERT INTO room_enterprises(room_id,enterprise_id) SELECT $1,qg.enterprise_id FROM queue_groups qg JOIN queue_group_challenges qgc ON qgc.queue_group_id=qg.id WHERE qgc.challenge_id=$2`,
        [room.id, challengeId],
      );
      await pool.query(
        `INSERT INTO room_queue_groups(room_id,queue_group_id) SELECT $1,queue_group_id FROM queue_group_challenges WHERE challenge_id=$2`,
        [room.id, challengeId],
      );
      await pool.query(
        `INSERT INTO room_queue_state(room_id,desired_minutes_per_team,is_paused) VALUES($1,6,false)`,
        [room.id],
      );
    }
    const reader = await createUserWithCapabilities([CAPABILITIES.PROJECTS_READ]);
    const result = await server.inject({
      method: "GET",
      url: `/api/repos/${second}`,
      headers: asUser(reader),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().challenges[0]).toMatchObject({
      position: 2,
      etaMinutes: 10,
      rooms: [{ name: "Room A" }, { name: "Room B" }],
    });
  });
  it("lists repos with members and selected challenges before any queue exists", async () => {
    const server = await getApp();
    const { beansId, caffeineId, aiId } = await seedProjects();

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
    expect(beans).toMatchObject({ id: beansId, submission_status: "submitted" });
    expect(beans.members).toHaveLength(2);
    expect(beans.challenges.map((c: { id: number }) => c.id).sort()).toEqual(
      [caffeineId, aiId].sort(),
    );
    expect(beans.challenges[0]).toMatchObject({ status: null, position: null, rooms: [] });

    const single = await server.inject({
      method: "GET",
      url: `/api/repos/${beansId}`,
      headers: asUser(reader),
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().name).toBe("Neural Beans");
    expect(single.json().members).toHaveLength(2);

    const missing = await server.inject({
      method: "GET",
      url: "/api/repos/999999",
      headers: asUser(reader),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("lists every mandatory challenge as entered without a selection", async () => {
    const server = await getApp();
    const owner = await createUser();
    const mandatory = await createChallenge("Everyone", { mandatory: true });
    const repo = await createProject([owner]);
    const reader = await createUserWithCapabilities([CAPABILITIES.PROJECTS_READ]);
    const res = await server.inject({
      method: "GET",
      url: `/api/repos/${repo}`,
      headers: asUser(reader),
    });
    expect(res.json().challenges).toEqual([
      expect.objectContaining({ id: mandatory, mandatory: true, status: null }),
    ]);
  });

  it("adds a challenge as a selection before generation and to the queue after (H21)", async () => {
    const server = await getApp();
    const { beansId, rustaceanId } = await seedProjects();
    const challengeId = await createChallenge("Live Queue");
    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_READ,
      CAPABILITIES.PROJECTS_EDIT,
    ]);

    const before = await server.inject({
      method: "POST",
      url: `/api/repos/${beansId}/challenges`,
      headers: asUser(operator),
      payload: { challengeId },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ entry: null });
    const selection = await pool.query(
      `SELECT 1 FROM project_challenges WHERE repo_id = $1 AND challenge_id = $2`,
      [beansId, challengeId],
    );
    expect(selection.rowCount).toBe(1);
    expect(
      (await pool.query(`SELECT 1 FROM queue_entries WHERE challenge_id = $1`, [challengeId]))
        .rowCount,
    ).toBe(0);

    // Once the queue exists, entering appends at the bottom immediately.
    await pool.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, position) VALUES ($1, $2, 'waiting', 1)`,
      [challengeId, beansId],
    );
    const after = await server.inject({
      method: "POST",
      url: `/api/repos/${rustaceanId}/challenges`,
      headers: asUser(operator),
      payload: { challengeId },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().entry).toMatchObject({ repo_id: rustaceanId, status: "waiting" });

    const single = await server.inject({
      method: "GET",
      url: `/api/repos/${rustaceanId}`,
      headers: asUser(operator),
    });
    expect(single.json().challenges).toContainEqual(
      expect.objectContaining({ id: challengeId, title: "Live Queue", status: "waiting" }),
    );
  });

  it("scopes evaluation status/nota to full-access staff and the owning sponsor only", async () => {
    const server = await getApp();
    const { beansId } = await seedProjects();
    const challengeId = await createChallenge("Judged Challenge");
    await pool.query(`UPDATE challenges SET judging_panel_criteria = $1::jsonb WHERE id = $2`, [
      JSON.stringify([
        {
          key: "score",
          kind: "scale",
          label: { en: "Score", es: "Nota", gl: "Nota" },
          min: 0,
          max: 10,
        },
      ]),
      challengeId,
    ]);
    const owner = (
      await pool.query(
        `SELECT s.user_id FROM challenges c JOIN sponsors s ON s.id = c.author WHERE c.id = $1`,
        [challengeId],
      )
    ).rows[0].user_id;

    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_READ,
      CAPABILITIES.PROJECTS_EDIT,
    ]);
    const beans = { id: beansId };
    const entryId = (
      await pool.query(
        `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
         VALUES ($1, $2, 'completed', NULL) RETURNING id`,
        [challengeId, beans.id],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO attempt_review (attempt_id, scores, status) VALUES ($1, $2::jsonb, 'submitted')`,
      [entryId, JSON.stringify({ score: 8 })],
    );

    // Full-access staff see the real status and derived nota.
    const asStaff = await server.inject({
      method: "GET",
      url: `/api/repos/${beans.id}`,
      headers: asUser(operator),
    });
    expect(asStaff.json().challenges).toContainEqual(
      expect.objectContaining({ id: challengeId, reviewStatus: "submitted", nota: 8 }),
    );

    // The owning sponsor rep sees it too.
    const asOwner = await server.inject({
      method: "GET",
      url: `/api/repos/${beans.id}`,
      headers: asUser(owner),
    });
    expect(asOwner.json().challenges).toContainEqual(
      expect.objectContaining({ id: challengeId, reviewStatus: "submitted", nota: 8 }),
    );

    // A different sponsor's rep sees the entry (via full-access? no — must not
    // have any scope onto this repo at all unless linked to that challenge).
    // Instead, verify a sponsor of a DIFFERENT challenge that also judges this
    // same repo cannot see this challenge's evaluation.
    const otherChallengeId = await createChallenge("Other Challenge");
    const otherOwner = (
      await pool.query(
        `SELECT s.user_id FROM challenges c JOIN sponsors s ON s.id = c.author WHERE c.id = $1`,
        [otherChallengeId],
      )
    ).rows[0].user_id;
    await server.inject({
      method: "POST",
      url: `/api/repos/${beans.id}/challenges`,
      headers: asUser(operator),
      payload: { challengeId: otherChallengeId },
    });
    const asOtherOwner = await server.inject({
      method: "GET",
      url: `/api/repos/${beans.id}`,
      headers: asUser(otherOwner),
    });
    const judgedEntry = asOtherOwner
      .json()
      .challenges.find((c: { id: number }) => c.id === challengeId);
    expect(judgedEntry.reviewStatus).toBeNull();
    expect(judgedEntry.nota).toBeNull();
    const ownEntry = asOtherOwner
      .json()
      .challenges.find((c: { id: number }) => c.id === otherChallengeId);
    expect(ownEntry.reviewStatus).toBeNull(); // not yet evaluated, but visible (not hidden)
  });
});

describe("GET /api/repos scoping for judges & sponsors (H8, H44/H46)", () => {
  /** Put `judge` on the roster of the enterprise that authored `challengeId`. */
  async function assignJudge(judge: number, challengeId: number): Promise<void> {
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO enterprise_judges (enterprise_id, user_id)
       SELECT author.enterprise_id, $2
         FROM challenges c JOIN sponsors author ON author.id = c.author
        WHERE c.id = $1
       ON CONFLICT (enterprise_id, user_id) DO NOTHING`,
      [challengeId, judge],
    );
  }

  /** Enterprise + sponsor(user) + challenge authored by that sponsor. */
  async function createSponsorChallenge(sponsorUserId: number, title: string): Promise<number> {
    const { pool } = await import("../../src/db/pool.js");
    const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
      `Ent ${crypto.randomUUID().slice(0, 8)}`,
    ]);
    const sponsor = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [enterprise.rows[0].id, sponsorUserId],
    );
    const challenge = await pool.query(
      `INSERT INTO challenges (author, title) VALUES ($1, $2) RETURNING id`,
      [sponsor.rows[0].id, title],
    );
    return challenge.rows[0].id;
  }

  it("a judge sees only repos of their assigned challenge; a full reader sees all", async () => {
    const server = await getApp();
    // Caffeine has only Neural Beans; AI has both projects.
    const { caffeineId: caffeine } = await seedProjects();

    // Relationship scope is sufficient; it must not widen to every project.
    const judge = await createUser();
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

  it("a sponsor relationship with no challenge gets an empty list, not a 403", async () => {
    const server = await getApp();
    await seedProjects();

    const sponsor = await createUser();
    const enterprise = await pool.query(
      `INSERT INTO enterprises (name) VALUES ('empty scope') RETURNING id`,
    );
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      enterprise.rows[0].id,
      sponsor,
    ]);
    const res = await server.inject({ method: "GET", url: "/api/repos", headers: asUser(sponsor) });
    expect(res.statusCode).toBe(200);
    expect(res.json().repos).toHaveLength(0);
  });

  it("a sponsor rep sees only their enterprise's challenges' repos", async () => {
    const server = await getApp();
    const { beansId } = await seedProjects();

    const sponsorUser = await createUser();
    const own = await createSponsorChallenge(sponsorUser, "Sponsor Caffeine");
    await pool.query(`INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2)`, [
      beansId,
      own,
    ]);

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

  it("rejects anonymous and foreign repository probes while allowing wildcard access", async () => {
    const server = await getApp();
    const { caffeineId: caffeine } = await seedProjects();
    const judge = await createUser();
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

    const anonymous = await server.inject({ method: "GET", url: `/api/repos/${beans.id}` });
    expect(anonymous.statusCode).toBe(401);

    const outOfScope = await server.inject({
      method: "GET",
      url: `/api/repos/${rustacean.id}`,
      headers: asUser(judge),
    });
    expect(outOfScope.statusCode).toBe(403);

    const wildcard = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const globallyAllowed = await server.inject({
      method: "GET",
      url: `/api/repos/${rustacean.id}`,
      headers: asUser(wildcard),
    });
    expect(globallyAllowed.statusCode).toBe(200);
  });
});

describe("GET /api/me/projects (participant self-view)", () => {
  it("returns only repos where I have a submission; requires auth", async () => {
    const server = await getApp();
    const { aliceId, bobId } = await seedProjects();
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status)
       SELECT id, $1, 'invited' FROM repos WHERE name = 'Rustacean Station'`,
      [aliceId],
    );

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
    // A pending invite to Rustacean Station is not a membership yet.
    expect(projects[0].name).toBe("Neural Beans");
    expect(projects[0].challenges).toHaveLength(2);
    const teammate = projects[0].members.find((m: { userId: number }) => m.userId === bobId);
    expect(teammate.email).toBeNull();

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
    const { aliceId, bobId } = await seedProjects();

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
    expect(res.json().projects[0]).toMatchObject({ name: "Neural Beans" });

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

  it("removes a roster member from project, queue, and profile views", async () => {
    const server = await getApp();
    const { aliceId, beansId: beans } = await seedProjects();
    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.PROJECTS_READ,
      CAPABILITIES.USERS_READ,
      CAPABILITIES.QUEUE_ADMIN,
    ]);

    const challengeId = await createChallenge("Beans queue");
    const room = await pool.query(`INSERT INTO rooms (name) VALUES ('Beans room') RETURNING id`);
    const roomId = room.rows[0].id;
    await pool.query(
      `INSERT INTO room_enterprises (room_id, enterprise_id)
       SELECT $1, qg.enterprise_id
         FROM queue_group_challenges qgc
         JOIN queue_groups qg ON qg.id = qgc.queue_group_id
        WHERE qgc.challenge_id = $2`,
      [roomId, challengeId],
    );
    await pool.query(
      `INSERT INTO room_queue_groups (room_id, queue_group_id)
       SELECT $1, queue_group_id FROM queue_group_challenges WHERE challenge_id = $2`,
      [roomId, challengeId],
    );
    await pool.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
       VALUES ($1, $2, 'waiting', 1)`,
      [challengeId, beans],
    );

    const removed = await server.inject({
      method: "DELETE",
      url: `/api/repos/${beans}/members/${aliceId}`,
      headers: asUser(operator),
    });
    expect(removed.statusCode).toBe(200);

    const sub = await pool.query(`SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2`, [
      beans,
      aliceId,
    ]);
    expect(sub.rows).toHaveLength(0);
    const audit = await pool.query(
      `SELECT before FROM audit_log
        WHERE entity_type = 'submission' AND entity_id = $1 AND action = 'remove_member'`,
      [`${beans}:${aliceId}`],
    );
    expect(audit.rows[0].before).toMatchObject({ userId: aliceId });

    const roster = await server.inject({
      method: "GET",
      url: `/api/repos/${beans}`,
      headers: asUser(operator),
    });
    expect((roster.json().members as { userId: number }[]).some((m) => m.userId === aliceId)).toBe(
      false,
    );

    const queue = await server.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/view`,
      headers: asUser(operator),
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().next[0].repo_members).not.toContainEqual(
      expect.objectContaining({ userId: aliceId }),
    );

    const res = await server.inject({
      method: "GET",
      url: `/api/users/${aliceId}/projects`,
      headers: asUser(operator),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toEqual([]);
  });
});

describe("POST /api/repos/:repoId/members (PROJECTS_EDIT)", () => {
  it("adds an existing internal user and returns them in project detail", async () => {
    const server = await getApp();
    await seedProjects();
    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.PROJECTS_READ,
    ]);

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
