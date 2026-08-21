import "./env.js";
import { ACTIVITY_KINDS, MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";

/**
 * Schedule categories come from one registry (@hackos/shared/activity-kinds)
 * so the API, web and mobile can't drift apart. These tests pin the API half
 * of that contract: only registry ids are writable, meal-ness is decided by
 * the registry's `scan` field (not a hardcoded 'meal'), and the mirrored
 * scanner activity carries the same category (H25, H26, H48).
 */

let app: App;
let manager: number;

const start = new Date("2030-01-01T12:00:00.000Z");

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
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

function create(type: string | null) {
  return app.inject({
    method: "POST",
    url: "/api/schedule",
    headers: asUser(manager),
    payload: {
      title: `Item ${type ?? "untyped"}`,
      type,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
      // Meals are forced scannable, and a scannable item must be
      // participant-visible (H59) — tag every item so the kinds are comparable.
      audiences: ["participant"],
    },
  });
}

describe("schedule categories (shared activity-kind registry)", () => {
  it("accepts every registry kind and mirrors it onto the scanner activity", async () => {
    const { pool } = await import("../../src/db/pool.js");
    for (const kind of ACTIVITY_KINDS) {
      const res = await create(kind);
      expect(res.statusCode, `kind ${kind}`).toBe(201);
      const item = res.json() as { id: number; type: string; requiresScan: boolean };
      expect(item.type).toBe(kind);
      // Meal-ness is the registry's `scan` field, never a hardcoded 'meal'.
      expect(item.requiresScan).toBe(MEAL_ACTIVITY_KINDS.includes(kind));

      const { rows } = await pool.query(
        `SELECT category, requires_scan FROM activities WHERE schedule_id = $1`,
        [item.id],
      );
      expect(rows[0].category).toBe(kind);
      expect(rows[0].requires_scan).toBe(MEAL_ACTIVITY_KINDS.includes(kind));
    }
  });

  it("rejects a category that is not in the registry", async () => {
    const res = await create("karaoke");
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown category on update too", async () => {
    const created = await create("workshop");
    const { id } = created.json() as { id: number };
    const res = await app.inject({
      method: "PATCH",
      url: `/api/schedule/${id}`,
      headers: asUser(manager),
      payload: { type: "karaoke" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("still allows an untyped item", async () => {
    const res = await create(null);
    expect(res.statusCode).toBe(201);
    expect((res.json() as { type: string | null }).type).toBeNull();
  });
});
