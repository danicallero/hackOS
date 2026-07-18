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
  PROJECT_URLS,
  participantsCsv,
  projectsCsv,
  projectsCsvV2,
  seedMatchableUsers,
} from "./fixtures.js";

/** H16: Devpost import — preview (pure) + confirm (idempotent upserts). */

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

const payload = () => ({ projectsCsv: projectsCsv(), participantsCsv: participantsCsv() });

describe("POST /api/devpost/imports/preview (H16)", () => {
  it("requires the PROJECTS_IMPORT capability", async () => {
    const server = await getApp();
    const anon = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/preview",
      payload: payload(),
    });
    expect(anon.statusCode).toBe(401);

    const pleb = await createUser();
    const forbidden = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/preview",
      headers: asUser(pleb),
      payload: payload(),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("matches members by primary and verified secondary email, never unverified (H6)", async () => {
    const server = await getApp();
    const { aliceId, bobId } = await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);

    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/preview",
      headers: asUser(operator),
      payload: payload(),
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json();

    expect(preview.totals.repos).toBe(2);
    expect(preview.totals.reposToCreate).toBe(2);
    expect(preview.totals.reposToUpdate).toBe(0);

    const beans = preview.repos.find((r: { title: string }) => r.title === "Neural Beans");
    expect(beans.action).toBe("create");
    expect(beans.url).toBe(PROJECT_URLS.neuralBeans);
    expect(beans.prizes).toEqual(["Best AI Hack", "Most Caffeinated"]);

    const byEmail = Object.fromEntries(beans.members.map((m: { email: string }) => [m.email, m]));
    // primary email match
    expect(byEmail[EMAILS.alice].matchType).toBe("primary_email");
    expect(byEmail[EMAILS.alice].matchedUserId).toBe(aliceId);
    // verified secondary email match (H6)
    expect(byEmail[EMAILS.bobDevpost].matchType).toBe("secondary_email");
    expect(byEmail[EMAILS.bobDevpost].matchedUserId).toBe(bobId);
    // member only present in the projects CSV team columns is still picked up
    expect(byEmail[EMAILS.frank].matchType).toBe("unmatched");

    const station = preview.repos.find((r: { title: string }) => r.title === "Rustacean Station");
    const stationByEmail = Object.fromEntries(
      station.members.map((m: { email: string }) => [m.email, m]),
    );
    // UNVERIFIED secondary email must NOT match
    expect(stationByEmail[EMAILS.carolDevpost].matchType).toBe("unmatched");
    expect(stationByEmail[EMAILS.carolDevpost].matchedUserId).toBeNull();
    // unknown email
    expect(stationByEmail[EMAILS.dave].matchType).toBe("unmatched");

    // participant row pointing at a project not in the export is surfaced
    expect(preview.unassignedParticipants).toHaveLength(1);
    expect(preview.unassignedParticipants[0].email).toBe(EMAILS.eve);
  });

  it("maps prizes to existing challenges via devpost_tags and writes NOTHING", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const challengeId = await createChallenge("AI Challenge", ["Best AI Hack"]);
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);

    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/preview",
      headers: asUser(operator),
      payload: payload(),
    });
    const preview = res.json();

    const aiPrize = preview.prizes.find((p: { name: string }) => p.name === "Best AI Hack");
    expect(aiPrize.mappedChallengeId).toBe(challengeId);
    expect(aiPrize.mappedChallengeTitle).toBe("AI Challenge");
    expect(aiPrize.repoCount).toBe(2);
    const otherPrize = preview.prizes.find((p: { name: string }) => p.name === "Most Caffeinated");
    expect(otherPrize.mappedChallengeId).toBeNull();

    // preview is pure: no repos, participants, prizes or submissions written
    const { pool } = await import("../../src/db/pool.js");
    for (const table of [
      "repos",
      "devpost_participants",
      "devpost_prizes",
      "repo_devpost_prizes",
      "submissions",
    ]) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });

  it("rejects a projects CSV without a recognizable title column", async () => {
    const server = await getApp();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/preview",
      headers: asUser(operator),
      payload: { projectsCsv: `"Foo","Bar"\n"a","b"`, participantsCsv: participantsCsv() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });
});

describe("POST /api/devpost/imports/confirm (H16)", () => {
  it("upserts repos, submissions, participants, prizes and audits the batch", async () => {
    const server = await getApp();
    const { aliceId, bobId } = await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);

    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/confirm",
      headers: asUser(operator),
      payload: payload(),
    });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.batchId).toMatch(/^dp_/);
    expect(result.counts).toEqual({
      reposCreated: 2,
      reposUpdated: 0,
      participantsMatched: 2, // alice (primary) + bob (verified secondary)
      participantsUnmatched: 3, // carol (unverified), dave, frank
      prizesSeen: 2,
      prizesUnmapped: 2, // neither prize is mapped to a challenge yet
    });

    const { pool } = await import("../../src/db/pool.js");

    const repos = await pool.query(`SELECT * FROM repos ORDER BY name`);
    expect(repos.rows).toHaveLength(2);
    const beans = repos.rows.find((r) => r.name === "Neural Beans");
    expect(beans.devpost_url).toBe(PROJECT_URLS.neuralBeans);
    expect(beans.demo_url).toBe("https://beans.example.com");

    // submissions only for matched users, imported_from devpost
    const subs = await pool.query(`SELECT * FROM submissions ORDER BY user_id`);
    expect(subs.rows.map((s) => s.user_id).sort()).toEqual([aliceId, bobId].sort());
    expect(new Set(subs.rows.map((s) => s.imported_from))).toEqual(new Set(["devpost"]));

    // devpost_participants row for EVERY member, batch stamped
    const parts = await pool.query(`SELECT * FROM devpost_participants`);
    expect(parts.rows).toHaveLength(5);
    expect(new Set(parts.rows.map((p) => p.import_batch))).toEqual(new Set([result.batchId]));
    const bobRow = parts.rows.find((p) => p.email === EMAILS.bobDevpost);
    expect(bobRow.merge_status).toBe("auto_matched");
    expect(bobRow.user_id).toBe(bobId);
    const carolRow = parts.rows.find((p) => p.email === EMAILS.carolDevpost);
    expect(carolRow.merge_status).toBe("unmatched");
    expect(carolRow.user_id).toBeNull();

    // prize catalogue + per-repo prizes
    const prizes = await pool.query(`SELECT * FROM devpost_prizes ORDER BY name`);
    expect(prizes.rows.map((p) => p.name)).toEqual(["Best AI Hack", "Most Caffeinated"]);
    expect(new Set(prizes.rows.map((p) => p.last_batch))).toEqual(new Set([result.batchId]));
    const repoPrizes = await pool.query(`SELECT * FROM repo_devpost_prizes`);
    expect(repoPrizes.rows).toHaveLength(3); // beans x2 + station x1

    // one audit row for the batch, with counts (H53)
    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'devpost_import' AND entity_id = $1`,
      [result.batchId],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].action).toBe("confirm");
    expect(auditRows.rows[0].actor_id).toBe(operator);
    expect(auditRows.rows[0].after.reposCreated).toBe(2);
  });

  it("re-importing the same files updates rather than duplicates (idempotency)", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);

    const first = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/confirm",
      headers: asUser(operator),
      payload: payload(),
    });
    expect(first.statusCode).toBe(200);

    // second import: same projects, tweaked description
    const second = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/confirm",
      headers: asUser(operator),
      payload: { projectsCsv: projectsCsvV2(), participantsCsv: participantsCsv() },
    });
    expect(second.statusCode).toBe(200);
    const result = second.json();
    expect(result.counts.reposCreated).toBe(0);
    expect(result.counts.reposUpdated).toBe(2);

    const { pool } = await import("../../src/db/pool.js");
    const repos = await pool.query(`SELECT * FROM repos`);
    expect(repos.rows).toHaveLength(2); // no duplicates
    const beans = repos.rows.find((r) => r.name === "Neural Beans");
    expect(beans.description).toContain("and your team"); // updated in place

    const parts = await pool.query(`SELECT count(*)::int AS n FROM devpost_participants`);
    expect(parts.rows[0].n).toBe(5); // (repo,email) keyed — no duplicates
    const subs = await pool.query(`SELECT count(*)::int AS n FROM submissions`);
    expect(subs.rows[0].n).toBe(2);
    const repoPrizes = await pool.query(`SELECT count(*)::int AS n FROM repo_devpost_prizes`);
    expect(repoPrizes.rows[0].n).toBe(3);

    // batch id moved forward on updated rows
    const anyPart = await pool.query(`SELECT import_batch FROM devpost_participants LIMIT 1`);
    expect(anyPart.rows[0].import_batch).toBe(result.batchId);

    // preview after import reports updates, not creates
    const previewRes = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/preview",
      headers: asUser(operator),
      payload: payload(),
    });
    expect(previewRes.json().totals.reposToUpdate).toBe(2);
  });

  it("a re-import never clobbers a manual link (H17 wins over re-import)", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);

    await server.inject({
      method: "POST",
      url: "/api/devpost/imports/confirm",
      headers: asUser(operator),
      payload: payload(),
    });

    const { pool } = await import("../../src/db/pool.js");
    const repo = await pool.query(`SELECT id FROM repos WHERE name = 'Rustacean Station'`);
    const repoId = repo.rows[0].id;
    const daveAccount = await createUser({ email: "dave-real@primary.test" });

    const link = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/link",
      headers: asUser(operator),
      payload: { repoId, email: EMAILS.dave, userId: daveAccount },
    });
    expect(link.statusCode).toBe(200);

    await server.inject({
      method: "POST",
      url: "/api/devpost/imports/confirm",
      headers: asUser(operator),
      payload: payload(),
    });

    const row = await pool.query(
      `SELECT user_id, merge_status FROM devpost_participants WHERE repo_id = $1 AND email = $2`,
      [repoId, EMAILS.dave],
    );
    expect(row.rows[0].merge_status).toBe("manually_linked");
    expect(row.rows[0].user_id).toBe(daveAccount);
  });
});
