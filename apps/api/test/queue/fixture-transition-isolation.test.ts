import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { entryHistory } from "../../src/modules/queue/reads.js";
import {
  bringIn,
  callNextForRoom,
  cancelEntry,
  clearQueueGroup,
  completePresentation,
  disqualify,
  enqueueQueueGroup,
  manualCall,
  markNoShow,
  moveToPosition,
  moveToTop,
  notifyEnter,
  pauseRoom,
  reEnter,
  remindWaitingRoom,
  removeRepoFromChallenge,
  requeue,
  resumeRoom,
  sendBackToWaiting,
  skipToEnd,
  startPresentation,
} from "../../src/modules/queue/service.js";
import { createUser, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  mergeChallengesIntoOneGroup,
  queueGroupOf,
} from "./fixtures.js";

async function markSyntheticChallenge(challengeId: number): Promise<void> {
  await pool.query(`UPDATE challenges SET is_test_account = true WHERE id = $1`, [challengeId]);
  await pool.query(
    `UPDATE users u
        SET is_test_account = true
       FROM sponsors s
      WHERE s.user_id = u.id
        AND s.id = (SELECT author FROM challenges WHERE id = $1)`,
    [challengeId],
  );
}

async function expectScopeFailure(
  action: () => Promise<unknown>,
  statusCode: number,
): Promise<void> {
  await expect(action()).rejects.toMatchObject({ statusCode });
}

describe("queue fixture transition isolation", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("guards every entry transition, room helper, and history read by actor marker", async () => {
    const realOperator = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
    ]);
    const fixtureOperator = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
    ]);
    const fixtureMember = await createUser();
    await pool.query(`UPDATE users SET is_test_account = true WHERE id IN ($1, $2)`, [
      fixtureOperator,
      fixtureMember,
    ]);

    const fixtureChallengeId = await createChallenge({ title: "Synthetic transition queue" });
    await markSyntheticChallenge(fixtureChallengeId);
    const { repoId: fixtureRepoId } = await createRepoWithTeam([fixtureMember], "Synthetic team");
    await pool.query(`UPDATE repos SET is_test_account = true WHERE id = $1`, [fixtureRepoId]);
    const fixtureRoomId = await createRoom({ name: "Synthetic transition room" });
    await assignChallengeToRoom(fixtureRoomId, fixtureChallengeId);
    const fixtureEntryId = await enqueueRepo(fixtureChallengeId, fixtureRepoId, 1);

    const realChallengeId = await createChallenge({ title: "Real transition queue" });
    const { repoId: realRepoId } = await createRepoWithTeam(undefined, "Real team");
    const realRoomId = await createRoom({ name: "Real transition room" });
    await assignChallengeToRoom(realRoomId, realChallengeId);
    const realEntryId = await enqueueRepo(realChallengeId, realRepoId, 1);

    const fixtureEntryTransitions = [
      () => notifyEnter(fixtureEntryId, realOperator),
      () => remindWaitingRoom(fixtureEntryId, realOperator),
      () => bringIn(fixtureEntryId, realOperator),
      () => startPresentation(fixtureEntryId, realOperator),
      () => completePresentation(fixtureEntryId, realOperator),
      () => sendBackToWaiting(fixtureEntryId, realOperator, "scope"),
      () => requeue(fixtureEntryId, realOperator, "top", "scope"),
      () => reEnter(fixtureEntryId, realOperator, "top", "scope"),
      () => markNoShow(fixtureEntryId, realOperator, "scope"),
      () => moveToPosition(fixtureEntryId, realOperator, 1, "scope"),
      () => skipToEnd(fixtureEntryId, realOperator, "scope"),
      () => moveToTop(fixtureEntryId, realOperator, "scope"),
      () => disqualify(fixtureEntryId, realOperator, "scope"),
      () => cancelEntry(fixtureEntryId, realOperator, "scope"),
      () => removeRepoFromChallenge(fixtureEntryId, realOperator, "scope"),
      () => manualCall(fixtureEntryId, realOperator, "called", fixtureRoomId, "scope"),
    ];
    for (const transition of fixtureEntryTransitions) {
      await expectScopeFailure(transition, 404);
    }

    const realEntryTransitions = [
      () => notifyEnter(realEntryId, fixtureOperator),
      () => remindWaitingRoom(realEntryId, fixtureOperator),
      () => bringIn(realEntryId, fixtureOperator),
      () => startPresentation(realEntryId, fixtureOperator),
      () => completePresentation(realEntryId, fixtureOperator),
      () => sendBackToWaiting(realEntryId, fixtureOperator, "scope"),
      () => requeue(realEntryId, fixtureOperator, "top", "scope"),
      () => reEnter(realEntryId, fixtureOperator, "top", "scope"),
      () => markNoShow(realEntryId, fixtureOperator, "scope"),
      () => moveToPosition(realEntryId, fixtureOperator, 1, "scope"),
      () => skipToEnd(realEntryId, fixtureOperator, "scope"),
      () => moveToTop(realEntryId, fixtureOperator, "scope"),
      () => disqualify(realEntryId, fixtureOperator, "scope"),
      () => cancelEntry(realEntryId, fixtureOperator, "scope"),
      () => removeRepoFromChallenge(realEntryId, fixtureOperator, "scope"),
      () => manualCall(realEntryId, fixtureOperator, "called", realRoomId, "scope"),
    ];
    for (const transition of realEntryTransitions) {
      await expectScopeFailure(transition, 403);
    }

    await expectScopeFailure(() => callNextForRoom(realOperator, fixtureRoomId), 404);
    await expectScopeFailure(() => callNextForRoom(fixtureOperator, realRoomId), 403);
    await expectScopeFailure(() => pauseRoom(fixtureRoomId, realOperator), 404);
    await expectScopeFailure(() => pauseRoom(realRoomId, fixtureOperator), 403);
    await expectScopeFailure(() => resumeRoom(fixtureRoomId, realOperator), 404);
    await expectScopeFailure(() => resumeRoom(realRoomId, fixtureOperator), 403);
    await expectScopeFailure(() => entryHistory(fixtureEntryId, realOperator), 404);
    await expectScopeFailure(() => entryHistory(realEntryId, fixtureOperator), 403);

    const fixtureGroupId = await queueGroupOf(fixtureChallengeId);
    const realGroupId = await queueGroupOf(realChallengeId);
    await expectScopeFailure(() => enqueueQueueGroup(fixtureGroupId, realOperator), 404);
    await expectScopeFailure(() => enqueueQueueGroup(realGroupId, fixtureOperator), 403);
    await expectScopeFailure(() => clearQueueGroup(fixtureGroupId, realOperator), 404);
    await expectScopeFailure(() => clearQueueGroup(realGroupId, fixtureOperator), 403);

    const { rows } = await pool.query(
      `SELECT id, status FROM queue_entries WHERE id = ANY($1::int[]) ORDER BY id`,
      [[fixtureEntryId, realEntryId]],
    );
    expect(rows.map((row: { status: string }) => row.status)).toEqual(["waiting", "waiting"]);
  });

  it("rejects both actors when a shared queue has mixed fixture markers", async () => {
    const realOperator = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const fixtureOperator = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [fixtureOperator]);

    const { challengeIds } = await createEnterpriseChallenges(2);
    const [realChallengeId, fixtureChallengeId] = challengeIds;
    if (realChallengeId == null || fixtureChallengeId == null) throw new Error("Missing challenge");
    await markSyntheticChallenge(fixtureChallengeId);
    const { repoId: realRepoId } = await createRepoWithTeam(undefined, "Mixed real team");
    const fixtureMember = await createUser();
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [fixtureMember]);
    const { repoId: fixtureRepoId } = await createRepoWithTeam(
      [fixtureMember],
      "Mixed synthetic team",
    );
    await pool.query(`UPDATE repos SET is_test_account = true WHERE id = $1`, [fixtureRepoId]);
    const queueGroupId = await mergeChallengesIntoOneGroup(challengeIds);
    const realEntryId = await enqueueRepo(realChallengeId, realRepoId, 1);
    const fixtureEntryId = await enqueueRepo(fixtureChallengeId, fixtureRepoId, 2);
    await pool.query(`UPDATE queue_entries SET status = 'cancelled' WHERE id IN ($1, $2)`, [
      realEntryId,
      fixtureEntryId,
    ]);

    await expectScopeFailure(() => reEnter(realEntryId, realOperator, "top", "mixed"), 409);
    await expectScopeFailure(() => reEnter(fixtureEntryId, fixtureOperator, "top", "mixed"), 409);
    await expectScopeFailure(() => enqueueQueueGroup(queueGroupId, realOperator), 409);
    await expectScopeFailure(() => clearQueueGroup(queueGroupId, fixtureOperator), 409);

    const { rows } = await pool.query(
      `SELECT status FROM queue_entries WHERE id IN ($1, $2) ORDER BY id`,
      [realEntryId, fixtureEntryId],
    );
    expect(rows.map((row: { status: string }) => row.status)).toEqual(["cancelled", "cancelled"]);
  });
});
