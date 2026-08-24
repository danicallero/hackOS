import "./env.js";
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
  addChallengeJudge,
  assignChallengeToRoom,
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
