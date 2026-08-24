import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
  assignChallengeToRoom,
  assignQueueGroupToRoom,
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  mergeChallengesIntoOneGroup,
} from "./fixtures.js";

/**
 * The position invariant (plan/07 §4): `queue_entries.position` is a dense
 * rank, 1..N over a queue_group's active entries — no gaps, no zero, no
 * negatives — after ANY sequence of moves, not just after an explicit
 * compaction. What is stored is what every surface displays.
 *
 * Before this, "move to top" wrote `min - 1` and "move to bottom" wrote
 * `max + 1`, so a few moves left the queue at `-3, -2, 1, 4, 9`: a correct
 * ordering that read as nonsense wherever a position was shown.
 */

let app: App;
let actorId: number;

beforeEach(async () => {
  await truncateAll();
  app = app ?? (await buildTestApp());
  actorId = await createUserWithCapabilities([
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.QUEUE_OPERATE,
  ]);
});

afterAll(async () => {
  await app?.close();
});

/** Every active position in the challenge's group, in queue order. */
async function positions(challengeId: number): Promise<number[]> {
  const { pool } = await import("../../src/db/pool.js");
  const { rows } = await pool.query(
    `SELECT qe.position
       FROM queue_entries qe
       JOIN queue_group_challenges self ON self.challenge_id = $1
       JOIN queue_group_challenges sib ON sib.queue_group_id = self.queue_group_id
      WHERE qe.challenge_id = sib.challenge_id
        AND qe.status IN ('waiting', 'called')
      ORDER BY qe.position ASC NULLS LAST, qe.id ASC`,
    [challengeId],
  );
  return rows.map((row: { position: number | null }) => Number(row.position));
}

function expectDense(actual: number[]) {
  expect(actual).toEqual(Array.from({ length: actual.length }, (_, i) => i + 1));
}

describe("dense 1..N positions", () => {
  it("survives a long mixed sequence of moves without gaps or negatives", async () => {
    const { moveToTop, requeue, skipToEnd, markNoShow, callNextForRoom } = await import(
      "../../src/modules/queue/service.js"
    );
    const { challengeIds } = await createEnterpriseChallenges(1);
    const challengeId = challengeIds[0]!;
    const roomId = await createRoom({ maxInWaitingArea: 5 });
    await assignChallengeToRoom(roomId, challengeId);

    const entries: number[] = [];
    for (let i = 0; i < 6; i++) {
      const { repoId } = await createRepoWithTeam();
      entries.push(await enqueueRepo(challengeId, repoId, i + 1));
    }
    expectDense(await positions(challengeId));

    // The move that used to produce position 0, then -1, then -2...
    await moveToTop(entries[4]!, actorId);
    expectDense(await positions(challengeId));
    await moveToTop(entries[5]!, actorId);
    expectDense(await positions(challengeId));
    await moveToTop(entries[3]!, actorId);
    const afterTops = await positions(challengeId);
    expectDense(afterTops);
    expect(Math.min(...afterTops)).toBe(1);

    // ...and the one that used to leave a widening gap at the back.
    await skipToEnd(entries[0]!, actorId);
    expectDense(await positions(challengeId));

    const called = await callNextForRoom(actorId, roomId);
    expect(called).not.toBeNull();
    expectDense(await positions(challengeId));

    await requeue(called!.id, actorId, "bottom");
    expectDense(await positions(challengeId));

    const called2 = await callNextForRoom(actorId, roomId);
    await markNoShow(called2!.id, actorId);
    expectDense(await positions(challengeId));
  });

  it("keeps one dense run across a shared queue's challenges", async () => {
    const { moveToTop, skipToEnd } = await import("../../src/modules/queue/service.js");
    const { challengeIds } = await createEnterpriseChallenges(3);
    const [first, second, third] = challengeIds as [number, number, number];
    const groupId = await mergeChallengesIntoOneGroup(challengeIds);
    const roomId = await createRoom();
    await assignQueueGroupToRoom(roomId, groupId);

    const made: number[] = [];
    for (const challengeId of [first, second, third, first, second]) {
      const { repoId } = await createRepoWithTeam();
      made.push(await enqueueRepo(challengeId, repoId, 1));
    }

    // Seeded with colliding positions on purpose — every challenge numbered
    // its own queue from 1 before the merge.
    await moveToTop(made[4]!, actorId);
    expectDense(await positions(first));
    await skipToEnd(made[0]!, actorId);
    const after = await positions(second);
    expectDense(after);
    // One ordering across all five teams, not three overlapping ones.
    expect(after).toHaveLength(5);
  });

  it("closes the gap when a team leaves the queue", async () => {
    const { removeRepoFromChallenge } = await import("../../src/modules/queue/service.js");
    const { challengeIds } = await createEnterpriseChallenges(1);
    const challengeId = challengeIds[0]!;

    const entries: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { repoId } = await createRepoWithTeam();
      entries.push(await enqueueRepo(challengeId, repoId, i + 1));
    }
    await removeRepoFromChallenge(entries[1]!, actorId, "withdrew");
    expectDense(await positions(challengeId));
    expect(await positions(challengeId)).toHaveLength(3);
  });

  it("serialises concurrent moves onto one dense ordering", async () => {
    const { moveToTop, skipToEnd } = await import("../../src/modules/queue/service.js");
    const { challengeIds } = await createEnterpriseChallenges(1);
    const challengeId = challengeIds[0]!;

    const entries: number[] = [];
    for (let i = 0; i < 6; i++) {
      const { repoId } = await createRepoWithTeam();
      entries.push(await enqueueRepo(challengeId, repoId, i + 1));
    }

    // Four moves racing on one queue. Whatever order they land in, the
    // ordering they leave behind has to be a clean 1..6.
    await Promise.all([
      moveToTop(entries[5]!, actorId),
      moveToTop(entries[4]!, actorId),
      skipToEnd(entries[0]!, actorId),
      skipToEnd(entries[1]!, actorId),
    ]);

    const after = await positions(challengeId);
    expectDense(after);
    expect(after).toHaveLength(6);
  });
});
