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
    expect(beans.challenges).toEqual([{ id: challengeId, title: "AI Challenge" }]);

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
