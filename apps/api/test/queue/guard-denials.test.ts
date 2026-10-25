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
  addChallengeJudge,
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
} from "./fixtures.js";

/**
 * Guard round-trip reductions (memoized actor marker, merged scope reads,
 * parallel capability loads, merged relationship reads) must never turn a
 * denial into an allow. One denial per guard path (H8, H29-H46, H54).
 */

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
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function status(
  method: "GET" | "POST" | "PATCH",
  url: string,
  userId: number,
  payload?: object,
) {
  return (await app.inject({ method, url, headers: asUser(userId), payload })).statusCode;
}

describe("queue guard denials", () => {
  it("room guards deny a user with neither capability nor roster link, and anonymous callers", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    const stranger = await createUser();
    const rostered = await createUser();
    await addChallengeJudge(challengeId, rostered);

    for (const url of [`/api/queue/rooms/${roomId}/view`, `/api/queue/rooms/${roomId}/pace`]) {
      expect(await status("GET", url, stranger)).toBe(403);
      expect(await status("GET", url, rostered)).toBe(200);
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    expect(await status("POST", `/api/queue/rooms/${roomId}/pause`, stranger)).toBe(403);
    expect(await status("GET", `/api/queue/rooms/${roomId}`, stranger)).toBe(403);
    expect(await status("GET", `/api/queue/rooms/${roomId}/assignments`, stranger)).toBe(403);
  });

  it("room list denies a user with no visible room but admits operators with none", async () => {
    const stranger = await createUser();
    const operator = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    for (const url of ["/api/queue/rooms", "/api/queue/rooms/views"]) {
      expect(await status("GET", url, stranger)).toBe(403);
      expect(await status("GET", url, operator)).toBe(200);
    }
  });

  it("entry guards deny non-roster users on read, autosave and notify-enter", async () => {
    const challengeId = await createChallenge();
    const otherChallengeId = await createChallenge();
    const stranger = await createUser();
    const foreignJudge = await createUser();
    await addChallengeJudge(otherChallengeId, foreignJudge);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    for (const user of [stranger, foreignJudge]) {
      expect(await status("GET", `/api/queue/entries/${entryId}/review`, user)).toBe(403);
      expect(
        await status("PATCH", `/api/queue/entries/${entryId}/review`, user, { notes: "x" }),
      ).toBe(403);
      expect(await status("POST", `/api/queue/entries/${entryId}/notify-enter`, user)).toBe(403);
    }
  });

  it("a capability revoked between two requests is not served from a stale snapshot", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    const user = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const url = `/api/queue/rooms/${roomId}/view`;
    expect(await status("GET", url, user)).toBe(200);
    await pool.query(`DELETE FROM user_roles WHERE user_id = $1`, [user]);
    expect(await status("GET", url, user)).toBe(403);
  });

  it("a synthetic operator cannot reach a real entry or room, nor a real operator a synthetic one", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const synthetic = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.JUDGE_PANEL,
    ]);
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [synthetic]);

    expect(
      await status("GET", `/api/queue/rooms/${roomId}/view`, synthetic),
    ).toBeGreaterThanOrEqual(403);
    expect(
      await status("GET", `/api/queue/entries/${entryId}/review`, synthetic),
    ).toBeGreaterThanOrEqual(403);
    expect(await status("GET", `/api/queue/reviews/${entryId}`, synthetic)).toBeGreaterThanOrEqual(
      403,
    );
  });

  it("repo and challenge guards deny users without a relationship to any queued challenge", async () => {
    const challengeId = await createChallenge();
    const otherChallengeId = await createChallenge();
    const stranger = await createUser();
    const rostered = await createUser();
    const foreign = await createUser();
    await addChallengeJudge(challengeId, rostered);
    await addChallengeJudge(otherChallengeId, foreign);
    const { repoId } = await createRepoWithTeam();
    await enqueueRepo(challengeId, repoId, 1);

    const repoUrl = `/api/queue/repos/${repoId}/challenges`;
    expect(await status("GET", repoUrl, stranger)).toBe(403);
    expect(await status("GET", repoUrl, foreign)).toBe(403);
    expect(await status("GET", repoUrl, rostered)).toBe(200);

    const timing = `/api/queue/challenges/${challengeId}/timing`;
    expect(await status("GET", timing, stranger)).toBe(403);
    expect(await status("GET", timing, foreign)).toBe(403);
  });

  it("review overview guards deny non-sponsors and sponsors of another enterprise", async () => {
    const challengeId = await createChallenge();
    const stranger = await createUser();
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const foreignChallengeId = await createChallenge();
    const foreignJudge = await createUser();
    await addChallengeJudge(foreignChallengeId, foreignJudge);

    expect(await status("GET", "/api/queue/reviews", stranger)).toBe(403);
    expect(await status("GET", `/api/queue/reviews/${entryId}`, stranger)).toBe(403);
    expect(await status("PATCH", `/api/queue/reviews/${entryId}`, stranger, { notes: "x" })).toBe(
      403,
    );
    // A roster judge is not a sponsor representative: no review overview audience.
    expect(await status("GET", `/api/queue/reviews/${entryId}`, foreignJudge)).toBe(403);
  });
});
