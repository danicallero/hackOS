import "./env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { notify, notifyMany } from "../../src/modules/notifications/service.js";
import { buildTestApp, createUser } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/** Batched fan-out keeps `notify` semantics per item (H51, H52, H54). */

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

beforeEach(async () => {
  await resetNotificationsState();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function outboxFor(userId: number) {
  const { rows } = await pool.query(
    `SELECT id, category, channel, payload FROM notification_outbox
      WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

describe("notifyMany", () => {
  it("returns [] for an empty batch", async () => {
    expect(await notifyMany(pool, [])).toEqual([]);
  });

  it("matches notify() per user, including preferences and ids per item", async () => {
    const a = await createUser();
    const b = await createUser();
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'announcements', 'push', false)`,
      [b],
    );
    const ids = await notifyMany(pool, [
      { userId: a, category: "announcements", payload: { subject: "s", body: "b" } },
      { userId: b, category: "announcements", payload: { subject: "s", body: "b" } },
    ]);
    expect(ids[0]).toHaveLength(3);
    expect(ids[1]).toHaveLength(2);
    expect((await outboxFor(a)).map((r) => r.id)).toEqual(ids[0]);
    expect((await outboxFor(b)).map((r) => r.channel)).toEqual(["in_app", "email"]);
    expect((await outboxFor(b)).map((r) => r.id)).toEqual(ids[1]);

    const c = await createUser();
    const single = await notify(pool, {
      userId: c,
      category: "announcements",
      payload: { subject: "s", body: "b" },
    });
    expect(single).toHaveLength(3);
  });

  it("pre-renders the inbox row per user language for template payloads", async () => {
    const es = await createUser();
    const en = await createUser();
    await pool.query(`UPDATE users SET language = 'es' WHERE id = $1`, [es]);
    await pool.query(`UPDATE users SET language = 'en' WHERE id = $1`, [en]);
    const payload = {
      template: "queue.called",
      vars: { name: "N", teamName: "T", challengeName: "C", roomName: "R" },
    };
    await notifyMany(pool, [
      { userId: es, category: "queue", channels: ["in_app"], payload },
      { userId: en, category: "queue", channels: ["in_app"], payload },
    ]);
    const [esRow] = await outboxFor(es);
    const [enRow] = await outboxFor(en);
    expect(typeof esRow.payload.subject).toBe("string");
    expect(esRow.payload.subject).not.toBe(enRow.payload.subject);
  });

  it("throws NotFound for a missing user and enqueues nothing from a failed batch", async () => {
    const a = await createUser();
    await expect(
      notifyMany(pool, [
        { userId: a, category: "announcements", payload: { subject: "s", body: "b" } },
        { userId: 999_999_999, category: "announcements", payload: { subject: "s", body: "b" } },
      ]),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await outboxFor(a)).toHaveLength(0);
  });

  it("enforces the fixture marker per item", async () => {
    const real = await createUser();
    await expect(
      notifyMany(pool, [
        {
          userId: real,
          category: "announcements",
          fixtureMarker: true,
          payload: { subject: "s", body: "b" },
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("enforces the actor scope per item", async () => {
    const real = await createUser();
    const synthetic = await createUser();
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [synthetic]);
    await expect(
      notifyMany(pool, [
        { userId: real, category: "project", actorId: synthetic, payload: { subject: "s" } },
      ]),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      notifyMany(pool, [
        { userId: synthetic, category: "project", actorId: real, payload: { subject: "s" } },
      ]),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
