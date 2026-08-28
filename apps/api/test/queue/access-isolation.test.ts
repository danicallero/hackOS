import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { SSE_TOPICS } from "@hackos/shared/events";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { notifyTeamCalled } from "../../src/modules/queue/notify.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  addChallengeJudge,
  assignChallengeToRoom,
  broadcastCount,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
} from "./fixtures.js";

/** AC-2C: relationship scope and public/operational SSE boundaries (H29-H46). */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
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

describe("queue contextual isolation", () => {
  it("allows an assigned judge only in their room/challenge, while wildcard access remains global", async () => {
    const judge = await createUser();
    const wildcard = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const challengeA = await createChallenge({
      judgingPanelCriteria: [{ key: "fit", type: "scale" }],
    });
    const challengeB = await createChallenge({
      judgingPanelCriteria: [{ key: "fit", type: "scale" }],
    });
    const roomA = await createRoom();
    const roomB = await createRoom();
    await assignChallengeToRoom(roomA, challengeA);
    await assignChallengeToRoom(roomB, challengeB);
    await addChallengeJudge(challengeA, judge);
    const { repoId: repoA } = await createRepoWithTeam();
    const { repoId: repoB } = await createRepoWithTeam();
    const entryA = await enqueueRepo(challengeA, repoA, 1);
    const entryB = await enqueueRepo(challengeB, repoB, 1);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/queue/rooms/${roomA}/view`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/queue/rooms/${roomB}/view`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/queue/entries/${entryA}/review`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/queue/entries/${entryB}/review`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(403);
    const assignedReviewStream = await app.inject({
      method: "GET",
      url: `/api/queue/entries/${entryA}/stream`,
      headers: asUser(judge),
      payloadAsStream: true,
    });
    expect(assignedReviewStream.statusCode).toBe(200);
    assignedReviewStream.stream().destroy();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/queue/entries/${entryB}/stream`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/queue/rooms/${roomB}/view`,
          headers: asUser(wildcard),
        })
      ).statusCode,
    ).toBe(200);
    // The grant is the enterprise roster, not the room: rostering the same
    // person on challenge B's enterprise — and nothing room-scoped — is what
    // opens room B to them.
    const enterpriseB = await addChallengeJudge(challengeB, judge);
    expect(enterpriseB).toBeDefined();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/queue/rooms/${roomB}/view`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(200);
  });

  it("reaches every room serving the judge's own enterprise, never another enterprise's room", async () => {
    // The roster is enterprise-scoped: a judge is no longer pinned to one
    // room, so two rooms serving the same challenge are both theirs — while
    // a room serving a different enterprise's challenge stays closed.
    const judge = await createUser();
    const challengeId = await createChallenge();
    const foreignChallengeId = await createChallenge();
    const assignedRoomId = await createRoom({ name: "Assigned room" });
    const siblingRoomId = await createRoom({ name: "Sibling room" });
    const foreignRoomId = await createRoom({ name: "Foreign room" });
    await assignChallengeToRoom(assignedRoomId, challengeId);
    await assignChallengeToRoom(siblingRoomId, challengeId);
    await assignChallengeToRoom(foreignRoomId, foreignChallengeId);
    await addChallengeJudge(challengeId, judge);

    for (const url of [
      `/api/queue/rooms/${assignedRoomId}/view`,
      `/api/queue/rooms/${assignedRoomId}/pace`,
      `/api/queue/rooms/${siblingRoomId}/view`,
      `/api/queue/rooms/${siblingRoomId}/pace`,
    ]) {
      expect((await app.inject({ method: "GET", url, headers: asUser(judge) })).statusCode).toBe(
        200,
      );
    }
    for (const url of [
      `/api/queue/rooms/${foreignRoomId}/view`,
      `/api/queue/rooms/${foreignRoomId}/pace`,
    ]) {
      expect((await app.inject({ method: "GET", url, headers: asUser(judge) })).statusCode).toBe(
        403,
      );
    }

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/queue/rooms/${assignedRoomId}/pause`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/queue/rooms/${foreignRoomId}/pause`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/queue/rooms/${assignedRoomId}/resume`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/queue/rooms/${foreignRoomId}/resume`,
          headers: asUser(judge),
        })
      ).statusCode,
    ).toBe(403);
  });

  it("rejects anonymous and unprivileged operational streams but permits authorized operators", async () => {
    const ordinary = await createUser();
    const operator = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const auditReader = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
    const logisticsReader = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);

    expect((await app.inject({ method: "GET", url: "/api/queue/stream" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/queue/stream", headers: asUser(ordinary) }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/api/events/stream?topic=applications" }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/events/stream" })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/api/events/stream?topic=not-a-domain" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/events/stream?topic=audit",
          headers: asUser(ordinary),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/events/stream?topic=logistics",
          headers: asUser(ordinary),
        })
      ).statusCode,
    ).toBe(403);

    const queueStream = await app.inject({
      method: "GET",
      url: "/api/queue/stream",
      headers: asUser(operator),
      payloadAsStream: true,
    });
    expect(queueStream.statusCode).toBe(200);
    queueStream.stream().destroy();

    const eventsStream = await app.inject({
      method: "GET",
      url: "/api/events/stream?topic=applications",
      headers: asUser(ordinary),
      payloadAsStream: true,
    });
    expect(eventsStream.statusCode).toBe(200);
    eventsStream.stream().destroy();

    for (const [user, topic] of [
      [auditReader, "audit"],
      [logisticsReader, "logistics"],
    ] as const) {
      const stream = await app.inject({
        method: "GET",
        url: `/api/events/stream?topic=${topic}`,
        headers: asUser(user),
        payloadAsStream: true,
      });
      expect(stream.statusCode).toBe(200);
      stream.stream().destroy();
    }
  });

  it("isolates fixture queue events and call notifications from real operators, users, and staff", async () => {
    const realOperator = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.PROJECTS_EDIT,
    ]);
    const fixtureOperator = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.PROJECTS_EDIT,
    ]);
    const fixtureMember = await createUser();
    const realMember = await createUser();
    const realStaff = await createUser();
    const fixtureStaff = await createUser();
    await pool.query(`UPDATE users SET is_test_account = true WHERE id IN ($1, $2, $3)`, [
      fixtureOperator,
      fixtureMember,
      fixtureStaff,
    ]);

    const fixtureChallengeId = await createChallenge({ title: "Synthetic queue" });
    const { repoId: fixtureRepoId } = await createRepoWithTeam(
      [fixtureMember, realMember],
      "Synthetic team",
    );
    await pool.query(`UPDATE challenges SET is_test_account = true WHERE id = $1`, [
      fixtureChallengeId,
    ]);
    await pool.query(
      `UPDATE users u
          SET is_test_account = true
         FROM sponsors s
        WHERE s.user_id = u.id
          AND s.id = (SELECT author FROM challenges WHERE id = $1)`,
      [fixtureChallengeId],
    );
    await pool.query(`UPDATE repos SET is_test_account = true WHERE id = $1`, [fixtureRepoId]);
    const fixtureRoomId = await createRoom({ name: "Synthetic room" });
    await assignChallengeToRoom(fixtureRoomId, fixtureChallengeId);

    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'queue.staff', 'push', true), ($2, 'queue.staff', 'push', true)`,
      [realStaff, fixtureStaff],
    );

    const realStream = await app.inject({
      method: "GET",
      url: "/api/queue/stream",
      headers: asUser(realOperator),
      payloadAsStream: true,
    });
    const fixtureStream = await app.inject({
      method: "GET",
      url: "/api/queue/stream",
      headers: asUser(fixtureOperator),
      payloadAsStream: true,
    });
    expect(realStream.statusCode).toBe(200);
    expect(fixtureStream.statusCode).toBe(200);
    const realFirstChunk: Buffer = await new Promise((resolve, reject) => {
      realStream.stream().once("data", resolve);
      realStream.stream().once("error", reject);
    });
    const fixtureFirstChunk: Buffer = await new Promise((resolve, reject) => {
      fixtureStream.stream().once("data", resolve);
      fixtureStream.stream().once("error", reject);
    });
    expect(realFirstChunk.toString()).toContain(`: connected topic=${SSE_TOPICS.QUEUE}\n`);
    expect(fixtureFirstChunk.toString()).toContain(
      `: connected topic=${SSE_TOPICS.QUEUE_FIXTURE}\n`,
    );

    const queueBeforeFixture = await broadcastCount(SSE_TOPICS.QUEUE);
    const fixtureQueueBefore = await broadcastCount(SSE_TOPICS.QUEUE_FIXTURE);
    const publicTvBeforeFixture = await broadcastCount(SSE_TOPICS.PUBLIC_TV);
    const fixtureAdd = await app.inject({
      method: "POST",
      url: `/api/repos/${fixtureRepoId}/challenges`,
      headers: { ...asUser(fixtureOperator), "idempotency-key": crypto.randomUUID() },
      payload: { challengeId: fixtureChallengeId },
    });
    expect(fixtureAdd.statusCode).toBe(200);
    expect(await broadcastCount(SSE_TOPICS.QUEUE)).toBe(queueBeforeFixture);
    expect(await broadcastCount(SSE_TOPICS.QUEUE_FIXTURE)).toBe(fixtureQueueBefore + 1);
    expect(await broadcastCount(SSE_TOPICS.PUBLIC_TV)).toBe(publicTvBeforeFixture);

    const fixtureEntryId = fixtureAdd.json().entry.id as number;
    await pool.query(
      `UPDATE queue_entries SET status = 'called', assigned_room_id = $2 WHERE id = $1`,
      [fixtureEntryId, fixtureRoomId],
    );
    const fixtureUserBefore = await broadcastCount(`${SSE_TOPICS.USER_PREFIX}${fixtureMember}`);
    const realUserBefore = await broadcastCount(`${SSE_TOPICS.USER_PREFIX}${realMember}`);
    await notifyTeamCalled(pool, {
      entryId: fixtureEntryId,
      challengeId: fixtureChallengeId,
      repoId: fixtureRepoId,
      roomId: fixtureRoomId,
      roomName: "Synthetic room",
    });
    expect(await broadcastCount(SSE_TOPICS.QUEUE)).toBe(queueBeforeFixture);
    expect(await broadcastCount(SSE_TOPICS.QUEUE_FIXTURE)).toBe(fixtureQueueBefore + 2);
    expect(await broadcastCount(`${SSE_TOPICS.USER_PREFIX}${fixtureMember}`)).toBeGreaterThan(
      fixtureUserBefore,
    );
    expect(await broadcastCount(`${SSE_TOPICS.USER_PREFIX}${realMember}`)).toBe(realUserBefore);

    const staffAlerts = await pool.query<{ user_id: number }>(
      `SELECT user_id
         FROM notification_outbox
        WHERE category = 'queue.staff' AND channel = 'push'
          AND payload->>'template' = 'queue.staff.called'
        ORDER BY user_id`,
    );
    expect(staffAlerts.rows.map((row) => row.user_id)).toEqual([fixtureStaff]);

    const realChallengeId = await createChallenge({ title: "Real queue" });
    const { repoId: realRepoId } = await createRepoWithTeam([realMember], "Real team");
    const realQueueBefore = await broadcastCount(SSE_TOPICS.QUEUE);
    const realPublicTvBefore = await broadcastCount(SSE_TOPICS.PUBLIC_TV);
    const realAdd = await app.inject({
      method: "POST",
      url: `/api/repos/${realRepoId}/challenges`,
      headers: { ...asUser(realOperator), "idempotency-key": crypto.randomUUID() },
      payload: { challengeId: realChallengeId },
    });
    expect(realAdd.statusCode).toBe(200);
    expect(await broadcastCount(SSE_TOPICS.QUEUE)).toBe(realQueueBefore + 1);
    expect(await broadcastCount(SSE_TOPICS.PUBLIC_TV)).toBe(realPublicTvBefore + 1);

    realStream.stream().destroy();
    fixtureStream.stream().destroy();
  });

  it("scopes the explicit challenge enqueue endpoint by fixture marker", async () => {
    const realOperator = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const fixtureOperator = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const fixtureMember = await createUser();
    await pool.query(`UPDATE users SET is_test_account = true WHERE id IN ($1, $2)`, [
      fixtureOperator,
      fixtureMember,
    ]);
    const challengeId = await createChallenge({ title: "Synthetic enqueue" });
    const { repoId } = await createRepoWithTeam([fixtureMember], "Synthetic enqueue team");
    await pool.query(`UPDATE challenges SET is_test_account = true WHERE id = $1`, [challengeId]);
    await pool.query(
      `UPDATE users u
          SET is_test_account = true
         FROM sponsors s
        WHERE s.user_id = u.id
          AND s.id = (SELECT author FROM challenges WHERE id = $1)`,
      [challengeId],
    );
    await pool.query(`UPDATE repos SET is_test_account = true WHERE id = $1`, [repoId]);

    const blocked = await app.inject({
      method: "POST",
      url: `/api/queue/challenges/${challengeId}/enqueue`,
      headers: { ...asUser(realOperator), "idempotency-key": crypto.randomUUID() },
      payload: { repoIds: [repoId] },
    });
    expect(blocked.statusCode).toBe(404);
    expect(
      (await pool.query(`SELECT 1 FROM queue_entries WHERE challenge_id = $1`, [challengeId]))
        .rowCount,
    ).toBe(0);

    const allowed = await app.inject({
      method: "POST",
      url: `/api/queue/challenges/${challengeId}/enqueue`,
      headers: { ...asUser(fixtureOperator), "idempotency-key": crypto.randomUUID() },
      payload: { repoIds: [repoId] },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().inserted).toHaveLength(1);
  });

  it("returns a sanitized public TV snapshot and keeps public invalidation streams anonymous", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE queue_entries SET status = 'called', assigned_room_id = $2 WHERE id = $1`,
      [entryId, roomId],
    );

    const snapshot = await app.inject({ method: "GET", url: "/api/tv/rooms" });
    expect(snapshot.statusCode).toBe(200);
    const text = snapshot.body;
    expect(text).toContain("repo_name");
    expect(text).not.toContain("repo_members");
    expect(text).not.toContain("repo_github_url");
    expect(text).not.toContain("email");

    for (const url of ["/api/tv/stream", "/api/content/stream"]) {
      const stream = await app.inject({ method: "GET", url, payloadAsStream: true });
      expect(stream.statusCode).toBe(200);
      stream.stream().destroy();
    }
  });
});
