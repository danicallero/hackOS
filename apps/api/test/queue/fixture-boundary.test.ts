import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { config } from "../../src/config.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUserWithCapabilities,
  seedAttendeeRoles,
  truncateAll,
} from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  queueGroupOf,
} from "./fixtures.js";

/**
 * H18/H54: the synthetic review operator and ordinary operators never reach each
 * other's queue, project or challenge data. Every route that takes an id is
 * called with both kinds of id, by both kinds of operator.
 */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  config.REVIEW_FIXTURE_PASSWORD = "review-fixture-password";
  config.REVIEW_FIXTURE_DELETION_PIN = "246810";
  await seedAttendeeRoles();
});

afterEach(() => {
  config.REVIEW_FIXTURE_PASSWORD = undefined;
  config.REVIEW_FIXTURE_DELETION_PIN = undefined;
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

type Ids = {
  roomId: number;
  entryId: number;
  queueGroupId: number;
  challengeId: number;
  repoId: number;
};

/** One id of every kind from the synthetic graph, and from an ordinary one. */
async function graphs(): Promise<{ fixture: Ids; real: Ids }> {
  const { rows: rooms } = await pool.query(`SELECT id FROM rooms ORDER BY id LIMIT 1`);
  const { rows: entries } = await pool.query(
    `SELECT qe.id, qe.repo_id, qe.challenge_id, qgc.queue_group_id
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
      WHERE c.is_test_account = true AND qe.status = 'waiting'
      ORDER BY qe.id LIMIT 1`,
  );
  const fixture: Ids = {
    roomId: rooms[0].id,
    entryId: entries[0].id,
    queueGroupId: entries[0].queue_group_id,
    challengeId: entries[0].challenge_id,
    repoId: entries[0].repo_id,
  };
  const challengeId = await createChallenge({ title: "Ordinary challenge" });
  const roomId = await createRoom({ name: "Ordinary room" });
  await assignChallengeToRoom(roomId, challengeId);
  const { repoId } = await createRepoWithTeam(undefined, "Ordinary project");
  const entryId = await enqueueRepo(challengeId, repoId, 1);
  const real: Ids = {
    roomId,
    entryId,
    queueGroupId: await queueGroupOf(challengeId),
    challengeId,
    repoId,
  };
  return { fixture, real };
}

const PREFIXES = ["/api/queue/", "/api/repos/", "/api/challenges/", "/api/projects/"];
const KNOWN = new Set(["roomId", "entryId", "queueGroupId", "challengeId", "repoId", "id"]);

function fill(url: string, ids: Ids): string | null {
  let ok = true;
  const filled = url.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    if (name === "id") {
      if (url.startsWith("/api/challenges/")) return String(ids.challengeId);
      if (url.startsWith("/api/repos/:id") || url.startsWith("/api/projects/:id")) {
        return String(ids.repoId);
      }
      ok = false;
      return "1";
    }
    if (name in ids) return String(ids[name as keyof Ids]);
    if (name === "rank" || name === "userId") return "1";
    ok = false;
    return "1";
  });
  return ok ? filled : null;
}

describe("review fixture boundary on queue, project and challenge routes", () => {
  it("keeps the synthetic operator and ordinary operators on their own side of every id route", async () => {
    app = await buildTestApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const regenerated = await app.inject({
      method: "POST",
      url: "/api/admin/review-fixtures/regenerate",
      headers: { ...asUser(admin), "idempotency-key": crypto.randomUUID() },
    });
    expect(regenerated.statusCode).toBe(200);
    const operatorEmail = (
      regenerated.json().accounts as Array<{ fixtureKey: string; email: string }>
    ).find((account) => account.fixtureKey === "staff-queue-operator")?.email as string;
    const { rows: operatorRows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [
      operatorEmail,
    ]);
    const syntheticOperator = operatorRows[0].id as number;
    const { fixture, real } = await graphs();
    const ordinaryOperator = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.JUDGE_PANEL,
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.CHALLENGES_MANAGE,
    ]);
    const wildcard = createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);

    const routes = app.routePolicyLedger.filter(
      (row) =>
        row.method !== "HEAD" &&
        !row.url.endsWith("/stream") &&
        PREFIXES.some((prefix) => row.url.startsWith(prefix)) &&
        [...row.url.matchAll(/:([A-Za-z]+)/g)].every((match) => KNOWN.has(match[1] as string)) &&
        /:[A-Za-z]+/.test(row.url),
    );
    expect(routes.length).toBeGreaterThan(60);

    const call = (user: number, method: string, url: string) =>
      app.inject({
        method: method as "GET",
        url,
        headers: { ...asUser(user), "idempotency-key": crypto.randomUUID() },
        ...(method === "GET" || method === "DELETE" ? {} : { payload: {} }),
      });
    const ordinary = [ordinaryOperator, await wildcard];
    const leaks: string[] = [];
    for (const route of routes) {
      const onFixture = fill(route.url, fixture);
      const onReal = fill(route.url, real);
      if (!onFixture || !onReal) continue;
      // The synthetic operator may never act on ordinary data...
      const crossed = await call(syntheticOperator, route.method, onReal);
      if (![403, 404, 409].includes(crossed.statusCode)) {
        leaks.push(`synthetic ${route.method} ${route.url} -> ${crossed.statusCode}`);
      }
      // ...and ordinary operators, wildcard included, never on synthetic data.
      for (const user of ordinary) {
        const reached = await call(user, route.method, onFixture);
        if (![403, 404, 409].includes(reached.statusCode)) {
          leaks.push(`ordinary ${route.method} ${route.url} -> ${reached.statusCode}`);
        }
      }
    }
    expect(leaks).toEqual([]);

    // A request that names ids from both sides is refused whichever side the caller is on.
    const mixed = await call(syntheticOperator, "POST", `/api/repos/${fixture.repoId}/challenges`);
    expect(mixed.statusCode).toBe(400);
    const crossBody = await app.inject({
      method: "POST",
      url: `/api/repos/${fixture.repoId}/challenges`,
      headers: { ...asUser(syntheticOperator), "idempotency-key": crypto.randomUUID() },
      payload: { challengeId: real.challengeId },
    });
    expect(crossBody.statusCode).toBe(403);

    // Positive control: the synthetic operator reaches its own data.
    for (const url of [
      `/api/queue/rooms/${fixture.roomId}/view`,
      `/api/queue/entries/${fixture.entryId}/history`,
      `/api/queue/repos/${fixture.repoId}/challenges`,
    ]) {
      expect((await call(syntheticOperator, "GET", url)).statusCode).toBe(200);
    }
  });

  it("lists only each side's own rooms, groups, challenges and projects", async () => {
    app = await buildTestApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const regenerated = await app.inject({
      method: "POST",
      url: "/api/admin/review-fixtures/regenerate",
      headers: { ...asUser(admin), "idempotency-key": crypto.randomUUID() },
    });
    const operatorEmail = (
      regenerated.json().accounts as Array<{ fixtureKey: string; email: string }>
    ).find((account) => account.fixtureKey === "staff-queue-operator")?.email as string;
    const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [operatorEmail]);
    const syntheticOperator = rows[0].id as number;
    await graphs();
    const ordinaryOperator = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.PROJECTS_READ,
      CAPABILITIES.CHALLENGES_MANAGE,
    ]);
    const lists = [
      "/api/queue/rooms",
      "/api/queue/groups",
      "/api/challenges",
      "/api/repos",
      "/api/queue/reviews",
    ];
    for (const url of lists) {
      const synthetic = await app.inject({
        method: "GET",
        url,
        headers: asUser(syntheticOperator),
      });
      const ordinary = await app.inject({ method: "GET", url, headers: asUser(ordinaryOperator) });
      for (const response of [synthetic, ordinary]) {
        expect(response.statusCode, url).toBeLessThan(500);
      }
      if (synthetic.statusCode === 200) {
        expect(synthetic.body, url).not.toContain("Ordinary");
      }
      if (ordinary.statusCode === 200) {
        expect(ordinary.body, url).not.toMatch(/Review room|\(review\)|Aurora Rover/);
      }
    }
    const room = await app.inject({
      method: "GET",
      url: "/api/queue/rooms",
      headers: asUser(syntheticOperator),
    });
    expect((room.json() as Array<{ name: string }>).map((entry) => entry.name).sort()).toEqual([
      "Review room A",
      "Review room B",
    ]);
  });

  it("lets the synthetic operator run the synthetic rooms end to end", async () => {
    app = await buildTestApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const regenerated = await app.inject({
      method: "POST",
      url: "/api/admin/review-fixtures/regenerate",
      headers: { ...asUser(admin), "idempotency-key": crypto.randomUUID() },
    });
    const operatorEmail = (
      regenerated.json().accounts as Array<{ fixtureKey: string; email: string }>
    ).find((account) => account.fixtureKey === "staff-queue-operator")?.email as string;
    const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [operatorEmail]);
    const operator = rows[0].id as number;
    const status = async (repo: string) => {
      const { rows: entry } = await pool.query(
        `SELECT qe.id, qe.status FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id
          WHERE r.name = $1`,
        [repo],
      );
      return entry[0] as { id: number; status: string };
    };
    const post = (url: string, payload: Record<string, unknown> = {}) =>
      app.inject({
        method: "POST",
        url,
        headers: { ...asUser(operator), "idempotency-key": crypto.randomUUID() },
        payload,
      });

    // Room B: the presenting team is scored.
    const ember = await status("Ember Engine");
    expect(ember.status).toBe("presenting");
    const completed = await post(`/api/queue/entries/${ember.id}/complete`);
    expect(completed.statusCode).toBe(200);
    expect((await status("Ember Engine")).status).toBe("completed");

    // Room A: the team inside is scored, then the called team is brought in.
    const tidal = await status("Tidal Lab");
    expect(tidal.status).toBe("in_room");
    expect((await post(`/api/queue/entries/${tidal.id}/start`)).statusCode).toBe(200);
    expect((await post(`/api/queue/entries/${tidal.id}/complete`)).statusCode).toBe(200);
    const nimbus = await status("Nimbus Notes");
    expect(nimbus.status).toBe("called");
    expect((await post(`/api/queue/entries/${nimbus.id}/bring-in`)).statusCode).toBe(200);
    expect((await status("Nimbus Notes")).status).toBe("in_room");
  });
});
