import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, truncateAll } from "../helpers.js";
import {
  createChallenge,
  createEnterpriseChallenges,
  createRepoWithTeam,
  enqueueRepo,
  mergeChallengesIntoOneGroup,
  queueGroupOf,
} from "./fixtures.js";

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("participant queue invalidations (H38, #544)", () => {
  it("coalesces a burst into one delayed challenge fan-out job", async () => {
    const challengeId = await createChallenge();
    const { notifyChallengeQueueChanged, QUEUE_PARTICIPANT_INVALIDATIONS } = await import(
      "../../src/modules/queue/notify.js"
    );
    const { getQueue } = await import("../../src/lib/queues.js");
    const { pool } = await import("../../src/db/pool.js");
    const queueGroupId = await queueGroupOf(challengeId);

    await Promise.all([
      notifyChallengeQueueChanged(pool, challengeId),
      notifyChallengeQueueChanged(pool, challengeId),
      notifyChallengeQueueChanged(pool, challengeId),
    ]);

    const jobs = await getQueue(QUEUE_PARTICIPANT_INVALIDATIONS).getJobs([
      "delayed",
      "waiting",
      "active",
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ challengeId, queueGroupId });

    const { register } = await import("../../src/lib/metrics.js");
    const metrics = await register.metrics();
    expect(metrics).toContain('hackos_queue_participant_invalidations_total{outcome="coalesced"}');
  });

  it("worker fan-out publishes one refresh per affected participant", async () => {
    const challengeId = await createChallenge();
    const first = await createUser();
    const second = await createUser();
    const { repoId } = await createRepoWithTeam([first, second]);
    await enqueueRepo(challengeId, repoId, 1);
    const { publishChallengeQueueInvalidation } = await import("../../src/modules/queue/notify.js");
    const { valkey } = await import("../../src/lib/valkey.js");

    await publishChallengeQueueInvalidation(challengeId);

    expect(await valkey.get(`sse:seq:user:${first}`)).toBe("1");
    expect(await valkey.get(`sse:seq:user:${second}`)).toBe("1");
  });

  it("fans out one merged-group invalidation to members queued on sibling challenges", async () => {
    const { challengeIds } = await createEnterpriseChallenges(2);
    const groupId = await mergeChallengesIntoOneGroup(challengeIds);
    const firstMember = await createUser();
    const secondMember = await createUser();
    const firstRepo = await createRepoWithTeam([firstMember]);
    const secondRepo = await createRepoWithTeam([secondMember]);
    await enqueueRepo(challengeIds[0]!, firstRepo.repoId, 1);
    await enqueueRepo(challengeIds[1]!, secondRepo.repoId, 2);
    const { publishChallengeQueueInvalidation } = await import("../../src/modules/queue/notify.js");
    const { valkey } = await import("../../src/lib/valkey.js");

    await publishChallengeQueueInvalidation(challengeIds[0]!, groupId);

    expect(await valkey.get(`sse:seq:user:${firstMember}`)).toBe("1");
    expect(await valkey.get(`sse:seq:user:${secondMember}`)).toBe("1");
  });

  it("re-resolves an explicit stale group id after a merge", async () => {
    const { challengeIds } = await createEnterpriseChallenges(2);
    const staleGroupId = await queueGroupOf(challengeIds[1]!);
    const currentGroupId = await mergeChallengesIntoOneGroup(challengeIds);
    const firstMember = await createUser();
    const secondMember = await createUser();
    const firstRepo = await createRepoWithTeam([firstMember]);
    const secondRepo = await createRepoWithTeam([secondMember]);
    await enqueueRepo(challengeIds[0]!, firstRepo.repoId, 1);
    await enqueueRepo(challengeIds[1]!, secondRepo.repoId, 2);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`DELETE FROM queue_groups WHERE id = $1`, [staleGroupId]);
    const { publishChallengeQueueInvalidation } = await import("../../src/modules/queue/notify.js");
    const { valkey } = await import("../../src/lib/valkey.js");

    await publishChallengeQueueInvalidation(challengeIds[1]!, staleGroupId);

    expect(currentGroupId).not.toBe(staleGroupId);
    expect(await valkey.get(`sse:seq:user:${firstMember}`)).toBe("1");
    expect(await valkey.get(`sse:seq:user:${secondMember}`)).toBe("1");
  });
});
