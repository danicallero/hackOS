import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { truncateAll } from "../helpers.js";

/**
 * Scheduled reveal trigger for the public schedule (H47, H48; issue #80).
 * Mirrors test/challenges/lifecycle.test.ts's visibility-publisher test.
 */

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function createScheduleItem(opts: {
  visibility: "shown" | "hidden";
  publishAt: Date | null;
}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, publish_at)
     VALUES ($1, now() + interval '1 day', now() + interval '1 day 1 hour', $2, $3)
     RETURNING id`,
    [`Activity ${crypto.randomUUID()}`, opts.visibility, opts.publishAt],
  );
  return rows[0].id;
}

describe("schedule visibility publisher (H47, H48, issue #80)", () => {
  it("flips due hidden items, leaves future/already-shown alone, and audits the flip", async () => {
    const due = await createScheduleItem({
      visibility: "hidden",
      publishAt: new Date(Date.now() - 60_000),
    });
    const future = await createScheduleItem({
      visibility: "hidden",
      publishAt: new Date(Date.now() + 3_600_000),
    });
    const alreadyShown = await createScheduleItem({ visibility: "shown", publishAt: null });
    const hiddenNoTrigger = await createScheduleItem({ visibility: "hidden", publishAt: null });

    const { runScheduleVisibilityPublisherOnce } = await import(
      "../../src/modules/logistics/schedule-publisher.js"
    );
    const result = await runScheduleVisibilityPublisherOnce();
    expect(result.published).toEqual([due]);

    const { rows } = await pool.query(
      `SELECT id, visibility FROM schedule WHERE id = ANY($1::int[]) ORDER BY id`,
      [[due, future, alreadyShown, hiddenNoTrigger]],
    );
    expect(Object.fromEntries(rows.map((r) => [Number(r.id), r.visibility]))).toEqual({
      [due]: "shown",
      [future]: "hidden",
      [alreadyShown]: "shown",
      [hiddenNoTrigger]: "hidden",
    });

    const audit = await pool.query(
      `SELECT action, entity_type, entity_id FROM audit_log WHERE entity_type = 'schedule' AND entity_id = $1`,
      [String(due)],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe("scheduled_reveal");

    // Re-running is a no-op: the gate (visibility='hidden') is consumed by the flip itself.
    const again = await runScheduleVisibilityPublisherOnce();
    expect(again.published).toEqual([]);
  });
});

describe("GET /api/public/activities (H47, H49)", () => {
  it("only returns items inside their visibility window", async () => {
    const { buildTestApp } = await import("../helpers.js");
    const app = await buildTestApp();
    try {
      const hiddenPastPublish = await createScheduleItem({
        visibility: "hidden",
        publishAt: new Date(Date.now() - 60_000),
      });
      const shownFuturePublish = await createScheduleItem({
        visibility: "shown",
        publishAt: new Date(Date.now() + 3_600_000),
      });
      const shownNoPublishAt = await createScheduleItem({ visibility: "shown", publishAt: null });
      const shownPastPublish = await createScheduleItem({
        visibility: "shown",
        publishAt: new Date(Date.now() - 60_000),
      });

      const res = await app.inject({ method: "GET", url: "/api/public/activities" });
      expect(res.statusCode).toBe(200);
      const ids = res.json().items.map((i: { id: number }) => i.id);
      expect(ids).not.toContain(hiddenPastPublish);
      expect(ids).not.toContain(shownFuturePublish);
      expect(ids).toContain(shownNoPublishAt);
      expect(ids).toContain(shownPastPublish);
    } finally {
      await app.close();
    }
  });
});
