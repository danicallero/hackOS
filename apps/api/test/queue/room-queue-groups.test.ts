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
  assignChallengeToRoom,
  assignQueueGroupToRoom,
  createChallenge,
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  mergeChallengesIntoOneGroup,
  queueGroupOf,
} from "./fixtures.js";

/**
 * H46: rooms serve a queue_group, not a challenge (0411 repoint). Two things
 * are under test: that a 1:1 group — every group that exists today — behaves
 * exactly as the old per-challenge link did, and that the group-aware code
 * paths do the right thing for a merged N>1 group, which only direct SQL can
 * build until the merge UI ships.
 */

let app: App;
let adminId: number;

beforeEach(async () => {
  await truncateAll();
  app = app ?? (await buildTestApp());
  adminId = await createUserWithCapabilities([
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.QUEUE_OPERATE,
  ]);
});

afterAll(async () => {
  await app?.close();
});

describe("0411 repoint", () => {
  it("gives every existing room_queue_groups row exactly one challenge (lossless backfill)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);

    // The link still resolves to the same single challenge it used to.
    const { rows } = await pool.query(
      `SELECT qgc.challenge_id
         FROM room_queue_groups rqg
         JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
        WHERE rqg.room_id = $1`,
      [roomId],
    );
    expect(rows).toEqual([{ challenge_id: challengeId }]);

    // The 0401 unique-per-room invariant survived the rename.
    const { rows: constraints } = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'room_queue_groups'::regclass
        AND conname = 'room_queue_groups_room_id_unique'`,
    );
    expect(constraints).toHaveLength(1);

    // No queue_group_id is ever null — the NOT NULL is the losslessness proof.
    const { rows: nulls } = await pool.query(
      `SELECT count(*)::int AS n FROM room_queue_groups WHERE queue_group_id IS NULL`,
    );
    expect(nulls[0].n).toBe(0);
  });

  it("drops challenge_id from the repointed table", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'room_queue_groups' ORDER BY column_name`,
    );
    expect(rows.map((r: { column_name: string }) => r.column_name)).toEqual([
      "assigned_at",
      "assigned_by",
      "queue_group_id",
      "room_id",
    ]);
  });
});

describe("1:1 group parity", () => {
  it("reads a room's challenge label, queue and pace exactly as before", async () => {
    const { roomView, roomPace, roomAssignments } = await import(
      "../../src/modules/queue/reads.js"
    );
    const challengeId = await createChallenge({ title: "Reto uno" });
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    const { repoId } = await createRepoWithTeam();
    await enqueueRepo(challengeId, repoId, 1);

    const view = await roomView(roomId);
    // The label still names the challenge itself, not the group.
    expect(view.challenge?.id).toBe(challengeId);
    expect(view.challenge?.title).toBe("Reto uno");
    expect(view.next).toHaveLength(1);
    expect(view.next[0]!.challenge_id).toBe(challengeId);

    const pace = await roomPace(roomId);
    expect(pace.pendingCount).toBe(1);
    expect(pace.roomCount).toBe(1);

    const assignments = await roomAssignments(roomId);
    expect(assignments.challenges.map((c: { challenge_id: number }) => c.challenge_id)).toEqual([
      challengeId,
    ]);
  });

  it("keeps possible_rooms to the rooms serving that challenge", async () => {
    const { myQueueStatus } = await import("../../src/modules/queue/reads.js");
    const challengeId = await createChallenge();
    const otherChallengeId = await createChallenge();
    const roomId = await createRoom();
    const otherRoomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    await assignChallengeToRoom(otherRoomId, otherChallengeId);

    const userId = await createUser();
    const { repoId } = await createRepoWithTeam([userId]);
    await enqueueRepo(challengeId, repoId, 1);

    const status = (await myQueueStatus(userId))[0]!;
    expect(status.rooms.map((r: { id: number }) => r.id)).toEqual([roomId]);
    expect(status.position).toBe(1);
  });

  it("ranks the back of a one-challenge queue exactly as before", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { nextBottomPosition } = await import("../../src/modules/queue/ordering.js");
    const challengeId = await createChallenge();
    const a = await createRepoWithTeam();
    const b = await createRepoWithTeam();
    await enqueueRepo(challengeId, a.repoId, 1);
    await enqueueRepo(challengeId, b.repoId, 2);

    expect(await nextBottomPosition(pool, challengeId)).toBe(3);
  });

  it("notifies exactly the room's own challenge on a room-level change", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { notifyRoomQueueChanged } = await import("../../src/modules/queue/notify.js");
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    // Resolves the room to its single challenge without throwing.
    await expect(notifyRoomQueueChanged(pool, roomId)).resolves.toBeUndefined();
  });
});

describe("merged N>1 group", () => {
  it("calls a room's whole group and expands possible_rooms to the group's rooms", async () => {
    const { myQueueStatus, roomView } = await import("../../src/modules/queue/reads.js");
    const { challengeIds } = await createEnterpriseChallenges(2);
    const second = challengeIds[1]!;
    const groupId = await mergeChallengesIntoOneGroup(challengeIds);

    const roomA = await createRoom();
    const roomB = await createRoom();
    await assignQueueGroupToRoom(roomA, groupId);
    await assignQueueGroupToRoom(roomB, groupId);

    const userId = await createUser();
    const { repoId } = await createRepoWithTeam([userId]);
    // Queued against only ONE of the group's challenges...
    await enqueueRepo(second, repoId, 1);

    // ...yet callable from every room serving the group.
    const view = await roomView(roomA);
    expect(view.next.map((e: { repo_id: number }) => e.repo_id)).toEqual([repoId]);

    const status = (await myQueueStatus(userId))[0]!;
    expect(status.rooms.map((r: { id: number }) => r.id).sort()).toEqual([roomA, roomB].sort());
  });

  it("shows a repo queued for two of the group's challenges once (call once)", async () => {
    const { roomView, roomPace } = await import("../../src/modules/queue/reads.js");
    const { challengeIds } = await createEnterpriseChallenges(2);
    const first = challengeIds[0]!;
    const second = challengeIds[1]!;
    const groupId = await mergeChallengesIntoOneGroup(challengeIds);
    const roomId = await createRoom();
    await assignQueueGroupToRoom(roomId, groupId);

    const shared = await createRepoWithTeam();
    const other = await createRepoWithTeam();
    // Two queue_entries rows — the schema still holds one per (challenge, repo).
    await enqueueRepo(first, shared.repoId, 1);
    await enqueueRepo(second, shared.repoId, 3);
    await enqueueRepo(first, other.repoId, 2);

    const view = await roomView(roomId);
    // One line item per team, at the team's best position.
    expect(view.next.map((e: { repo_id: number }) => e.repo_id)).toEqual([
      shared.repoId,
      other.repoId,
    ]);
    expect(view.next[0]!.queued_challenge_ids.sort()).toEqual([first, second].sort());

    // ...and counted once as pending work.
    expect((await roomPace(roomId)).pendingCount).toBe(2);
  });

  it("calls the merged team once, not once per entry", async () => {
    const { callNextForRoom } = await import("../../src/modules/queue/service.js");
    const { pool } = await import("../../src/db/pool.js");
    const { challengeIds } = await createEnterpriseChallenges(2);
    const first = challengeIds[0]!;
    const second = challengeIds[1]!;
    const groupId = await mergeChallengesIntoOneGroup(challengeIds);
    const roomId = await createRoom({ maxInWaitingArea: 5 });
    await assignQueueGroupToRoom(roomId, groupId);

    const shared = await createRepoWithTeam();
    const other = await createRepoWithTeam();
    await enqueueRepo(first, shared.repoId, 1);
    await enqueueRepo(second, shared.repoId, 2);
    await enqueueRepo(first, other.repoId, 3);

    const firstCall = await callNextForRoom(adminId, roomId);
    expect(firstCall?.repo_id).toBe(shared.repoId);
    // The next call skips the team's second entry and moves on to the next team.
    const secondCall = await callNextForRoom(adminId, roomId);
    expect(secondCall?.repo_id).toBe(other.repoId);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_entries
        WHERE repo_id = $1 AND status = 'called'`,
      [shared.repoId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("orders positions across the whole group, not per challenge", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { nextBottomPosition } = await import("../../src/modules/queue/ordering.js");
    const { challengeIds } = await createEnterpriseChallenges(2);
    const first = challengeIds[0]!;
    const second = challengeIds[1]!;
    await mergeChallengesIntoOneGroup(challengeIds);

    const a = await createRepoWithTeam();
    await enqueueRepo(first, a.repoId, 7);

    // The next team joining via the OTHER challenge queues behind it, rather
    // than restarting at 1 in a queue of its own. The back of the queue is a
    // rank over the whole group, not "highest position seen + 1" — the seeded
    // 7 is a gap the dense ordering closes, not a number to count from.
    expect(await nextBottomPosition(pool, second)).toBe(2);
  });
});

describe("room -> queue group assignment access", () => {
  it("lets the owning enterprise's rep assign, and refuses an unrelated sponsor", async () => {
    const { enterpriseId, repId, challengeIds } = await createEnterpriseChallenges(1);
    const groupId = await queueGroupOf(challengeIds[0]!);
    const roomId = await createRoom();
    const outsider = await createUser();

    const mine = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/queue-group`,
      headers: asUser(repId),
      payload: { queueGroupId: groupId },
    });
    expect(mine.statusCode).toBe(201);
    expect(mine.json().enterpriseId).toBe(enterpriseId);

    const theirs = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/queue-group`,
      headers: asUser(outsider),
      payload: { queueGroupId: groupId },
    });
    expect(theirs.statusCode).toBe(403);
  });

  it("refuses to hand a room from one enterprise to another without rights on both", async () => {
    const alpha = await createEnterpriseChallenges(1);
    const beta = await createEnterpriseChallenges(1);
    const roomId = await createRoom();

    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/queue-group`,
      headers: asUser(adminId),
      payload: { queueGroupId: await queueGroupOf(alpha.challengeIds[0]!) },
    });

    // Beta's rep may manage beta's group, but not take alpha's room away.
    const steal = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/queue-group`,
      headers: asUser(beta.repId),
      payload: { queueGroupId: await queueGroupOf(beta.challengeIds[0]!) },
    });
    expect(steal.statusCode).toBe(403);
  });

  it("404s on an unknown queue group", async () => {
    const roomId = await createRoom();
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/queue-group`,
      headers: asUser(adminId),
      payload: { queueGroupId: 999_999 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("lists only the caller's own groups for a sponsor rep", async () => {
    const alpha = await createEnterpriseChallenges(2);
    await createEnterpriseChallenges(1);

    const asAdmin = await app.inject({
      method: "GET",
      url: "/api/queue/groups",
      headers: asUser(adminId),
    });
    expect(asAdmin.json().groups.length).toBe(3);

    const asRep = await app.inject({
      method: "GET",
      url: "/api/queue/groups",
      headers: asUser(alpha.repId),
    });
    const groups = asRep.json().groups as { enterpriseId: number; challenges: unknown[] }[];
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.enterpriseId === alpha.enterpriseId)).toBe(true);
    expect(groups[0]!.challenges).toHaveLength(1);
  });
});
