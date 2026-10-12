import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";

/**
 * H8/H48/H59: `schedule:read` shows the full run-of-show (hidden, staff-only,
 * notes, owners) without any write access; `schedule:manage` implies read.
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

async function seedHiddenItem(): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences, notes)
     VALUES ('Staff prep', now() + interval '1 day', now() + interval '1 day 1 hour',
             'hidden', '{}', 'Bring cables')
     RETURNING id`,
  );
  return rows[0].id;
}

describe("schedule:read (H8, H48, H59)", () => {
  it("lists hidden items with staff notes and owners", async () => {
    const reader = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_READ]);
    const id = await seedHiddenItem();
    await pool.query(
      `INSERT INTO schedule_owners (schedule_id, free_text_name) VALUES ($1, 'Ana')`,
      [id],
    );

    const res = await app.inject({ method: "GET", url: "/api/schedule", headers: asUser(reader) });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { id: number }) => i.id === id);
    expect(item.visibility).toBe("hidden");
    expect(item.notes).toBe("Bring cables");
    expect(item.owners).toHaveLength(1);

    const owners = await app.inject({
      method: "GET",
      url: `/api/schedule/${id}/owners`,
      headers: asUser(reader),
    });
    expect(owners.statusCode).toBe(200);

    const feed = await app.inject({
      method: "GET",
      url: "/api/public/activities",
      headers: asUser(reader),
    });
    expect(feed.json().items.some((i: { id: number }) => i.id === id)).toBe(true);
  });

  it("is forbidden on every mutation", async () => {
    const reader = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_READ]);
    const id = await seedHiddenItem();
    const headers = asUser(reader);
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const endsAt = new Date(Date.now() + 90_000_000).toISOString();

    const attempts = [
      { method: "POST", url: "/api/schedule", payload: { title: "X", startsAt, endsAt } },
      { method: "PATCH", url: `/api/schedule/${id}`, payload: { title: "Y" } },
      { method: "DELETE", url: `/api/schedule/${id}` },
      {
        method: "POST",
        url: "/api/schedule/visibility",
        payload: { ids: [id], visibility: "shown" },
      },
      { method: "POST", url: `/api/schedule/${id}/owners`, payload: { freeTextName: "Eve" } },
    ] as const;
    for (const attempt of attempts) {
      const res = await app.inject({ ...attempt, headers });
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403);
    }
    const { rows } = await pool.query(`SELECT title FROM schedule WHERE id = $1`, [id]);
    expect(rows[0].title).toBe("Staff prep");
  });

  it("an unrelated staff user cannot list the full schedule", async () => {
    const other = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const res = await app.inject({ method: "GET", url: "/api/schedule", headers: asUser(other) });
    expect(res.statusCode).toBe(403);
  });

  it("schedule:manage keeps implying read", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const id = await seedHiddenItem();
    const res = await app.inject({ method: "GET", url: "/api/schedule", headers: asUser(manager) });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.some((i: { id: number }) => i.id === id)).toBe(true);
  });
});
