import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";

/**
 * H48/H59, #966: the roster toggles `liveActivityAudience` through the same
 * PATCH as every other inline schedule edit - audited, manage-only, and it
 * schedules an early Live Activity worker tick.
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

async function seedItem(): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences)
     VALUES ('Keynote', now() + interval '1 day', now() + interval '1 day 1 hour',
             'shown', '{participant}')
     RETURNING id`,
  );
  return rows[0].id;
}

function patch(userId: number, id: number, payload: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/api/schedule/${id}`,
    headers: asUser(userId),
    payload,
  });
}

describe("schedule Live Activity toggle (H48, H59, #966)", () => {
  it("turns it on and off, audits each change and kicks the worker", async () => {
    const { getQueue } = await import("../../src/lib/queues.js");
    const { LIVE_ACTIVITIES_QUEUE } = await import("../../src/modules/live-activities/kick.js");
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const id = await seedItem();
    await getQueue(LIVE_ACTIVITIES_QUEUE).obliterate({ force: true });

    const on = await patch(manager, id, { liveActivityAudience: true });
    expect(on.statusCode).toBe(200);
    expect(on.json().liveActivityAudience).toBe(true);
    const jobs = await getQueue(LIVE_ACTIVITIES_QUEUE).getJobs(["delayed", "waiting"]);
    expect(jobs.map((j) => j.name)).toContain("kick");

    const off = await patch(manager, id, { liveActivityAudience: false });
    expect(off.json().liveActivityAudience).toBe(false);

    const { rows } = await pool.query(
      `SELECT actor_id, before, after FROM audit_log
        WHERE entity_type = 'schedule' AND entity_id = $1 AND action = 'update' ORDER BY id`,
      [id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actor_id: manager });
    expect(rows[0].before.liveActivityAudience).toBe(false);
    expect(rows[0].after.liveActivityAudience).toBe(true);
    expect(rows[1].after.liveActivityAudience).toBe(false);
  });

  it("is forbidden for a read-only viewer and changes nothing", async () => {
    const reader = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_READ]);
    const id = await seedItem();
    const res = await patch(reader, id, { liveActivityAudience: true });
    expect(res.statusCode).toBe(403);
    const { rows } = await pool.query(`SELECT live_activity_audience FROM schedule WHERE id = $1`, [
      id,
    ]);
    expect(rows[0].live_activity_audience).toBe(false);
  });
});
