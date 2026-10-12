import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import { allowLiveActivities, participantInQueue, resetJudgingWindow } from "./fixtures.js";

/** #966: domain changes run the Live Activity worker early, debounced. */

let app: App;

async function kickJobs() {
  const { getQueue } = await import("../../src/lib/queues.js");
  const { LIVE_ACTIVITIES_KICK_JOB, LIVE_ACTIVITIES_QUEUE } = await import(
    "../../src/modules/live-activities/kick.js"
  );
  const jobs = await getQueue(LIVE_ACTIVITIES_QUEUE).getJobs(["delayed", "waiting"]);
  return jobs.filter((job) => job.name === LIVE_ACTIVITIES_KICK_JOB);
}

beforeEach(async () => {
  await truncateAll();
  await resetJudgingWindow();
  const { getQueue } = await import("../../src/lib/queues.js");
  const { LIVE_ACTIVITIES_QUEUE } = await import("../../src/modules/live-activities/kick.js");
  await getQueue(LIVE_ACTIVITIES_QUEUE).obliterate({ force: true });
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
});

afterAll(async () => {
  await resetJudgingWindow();
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("early Live Activity tick", () => {
  it("coalesces a burst of requests into one delayed tick", async () => {
    const { requestLiveActivitySync, LIVE_ACTIVITIES_KICK_DEBOUNCE_MS } = await import(
      "../../src/modules/live-activities/kick.js"
    );
    await Promise.all([
      requestLiveActivitySync(),
      requestLiveActivitySync(),
      requestLiveActivitySync(),
    ]);
    const jobs = await kickJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.opts.delay).toBe(LIVE_ACTIVITIES_KICK_DEBOUNCE_MS);
  });

  it("is requested by a queue change (H38)", async () => {
    const { entryId, challengeId } = await participantInQueue();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`DELETE FROM queue_entries WHERE id = $1`, [entryId]);
    const { notifyDeletedQueueEntries } = await import("../../src/modules/queue/notify.js");
    await notifyDeletedQueueEntries([
      { id: entryId, challengeId, repoId: 0, fixtureMarker: false },
    ]);
    expect(await kickJobs()).toHaveLength(1);
  });

  it("is requested by a schedule edit (H25, H59)", async () => {
    const { emitScheduleChanged } = await import("../../src/modules/logistics/schedule.js");
    await emitScheduleChanged({ action: "delete", id: 1 });
    expect(await kickJobs()).toHaveLength(1);
  });

  it("is requested by an event timing edit only (H19, H22)", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const save = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PUT",
        url: "/api/event",
        headers: { ...asUser(manager), "idempotency-key": crypto.randomUUID() },
        payload,
      });
    const { getQueue } = await import("../../src/lib/queues.js");
    const { LIVE_ACTIVITIES_QUEUE } = await import("../../src/modules/live-activities/kick.js");
    const hackingEndsAt = new Date(Date.now() + 26 * 3_600_000).toISOString();
    expect((await save({ hackingEndsAt })).statusCode).toBe(200);
    expect(await kickJobs()).toHaveLength(1);

    await getQueue(LIVE_ACTIVITIES_QUEUE).obliterate({ force: true });
    await (await import("../../src/lib/valkey.js")).valkey.flushdb();
    expect((await save({ name: "hackOS", hackingEndsAt })).statusCode).toBe(200);
    expect(await kickJobs()).toHaveLength(0);
  });

  it("is requested by a configuration save", async () => {
    const organizer = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    await allowLiveActivities();
    const current = await app.inject({
      method: "GET",
      url: "/api/live-activities/settings",
      headers: asUser(organizer),
    });
    const { maxConcurrent, kinds } = current.json() as {
      maxConcurrent: number;
      kinds: { kind: string; enabled: boolean; roleIds: number[] }[];
    };
    const saved = await app.inject({
      method: "PUT",
      url: "/api/live-activities/settings",
      headers: asUser(organizer),
      payload: {
        maxConcurrent,
        kinds: kinds.map(({ kind, enabled, roleIds }) => ({ kind, enabled, roleIds })),
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(await kickJobs()).toHaveLength(1);
  });
});
