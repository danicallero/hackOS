import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, truncateAll } from "../helpers.js";
import { createChallenge, createRepoWithTeam, enqueueRepo } from "./fixtures.js";

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
    expect(jobs[0]?.data).toEqual({ challengeId });

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
});
