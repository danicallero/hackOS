import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { runAnnouncementsPublisherOnce } from "../../src/modules/notifications/announcements-publisher.js";
import { asUser, buildTestApp, createRole, createUser } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/**
 * Multi-edition announcements and notifications (H50-H52): lists and the
 * public feed are scoped to the viewed edition, the inbox stays global, a
 * closed edition rejects writes and the scheduled publisher ignores it.
 */

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

async function createEdition(key: string) {
  await pool.query(`INSERT INTO editions (event_key, name, status) VALUES ($1, $1, 'active')`, [
    key,
  ]);
}

/** An announcements manager in the current edition and in `e2`. */
async function manager(): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
    userId,
    roleId,
  ]);
  return userId;
}

const titles = (body: { items: { title: string }[] }) => body.items.map((i) => i.title);

describe("announcement editions", () => {
  it("lists admin and public announcements per edition; by-id works across editions", async () => {
    await createEdition("e2");
    const admin = await manager();
    await pool.query(
      `INSERT INTO announcements (title, body, author_id, event_key)
       VALUES ('Now', 'b', $1, 'default'), ('Next', 'b', $1, 'e2')`,
      [admin],
    );
    const list = (edition?: string, url = "/api/announcements") =>
      app.inject({
        method: "GET",
        url,
        headers: { ...asUser(admin), ...(edition ? { "x-edition": edition } : {}) },
      });
    expect(titles((await list()).json())).toEqual(["Now"]);
    expect(titles((await list("e2")).json())).toEqual(["Next"]);
    expect(titles((await list(undefined, "/api/announcements/public")).json())).toEqual(["Now"]);
    expect(titles((await list("e2", "/api/announcements/public")).json())).toEqual(["Next"]);

    const { rows } = await pool.query("SELECT id FROM announcements WHERE title = 'Next'");
    const byId = await app.inject({
      method: "GET",
      url: `/api/announcements/${rows[0].id}`,
      headers: asUser(admin),
    });
    expect(byId.statusCode).toBe(200);
  });

  it("stores new announcements in the viewed edition and rejects a closed one", async () => {
    await createEdition("e2");
    const admin = await manager();
    const create = (edition?: string) =>
      app.inject({
        method: "POST",
        url: "/api/announcements",
        headers: {
          ...asUser(admin),
          "idempotency-key": crypto.randomUUID(),
          ...(edition ? { "x-edition": edition } : {}),
        },
        payload: { title: "T", body: "B" },
      });
    expect((await create("e2")).statusCode).toBe(201);
    const { rows } = await pool.query("SELECT event_key FROM announcements");
    expect(rows).toEqual([{ event_key: "e2" }]);

    await pool.query(
      "UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'e2'",
    );
    const closed = await create("e2");
    expect(closed.statusCode).toBe(409);
    expect(JSON.stringify(closed.json())).toContain("edition_closed");
  });

  it("keeps the inbox global and writable while an edition is closed", async () => {
    await createEdition("e2");
    const user = await createUser();
    const { rows } = await pool.query(
      `INSERT INTO notification_outbox (user_id, category, channel, payload)
       VALUES ($1, 'test', 'in_app', '{}'::jsonb) RETURNING id`,
      [user],
    );
    await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
      user,
      await createRole([]),
    ]);
    await pool.query(
      "UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'e2'",
    );
    const read = await app.inject({
      method: "POST",
      url: `/api/me/notifications/${rows[0].id}/read`,
      headers: {
        ...asUser(user),
        "x-edition": "e2",
        "idempotency-key": crypto.randomUUID(),
      },
    });
    expect(read.statusCode).toBeLessThan(300);
  });

  it("does not publish scheduled announcements once the current edition is closed", async () => {
    await createEdition("closing");
    await pool.query("INSERT INTO event_config (id, event_key, name) VALUES (1, 'closing', 'C')");
    const admin = await createUser();
    await pool.query(
      `INSERT INTO announcements (title, body, author_id, notify_users, channels, event_key)
       VALUES ('Due', 'b', $1, true, ARRAY['in_app'], 'closing')`,
      [admin],
    );
    await pool.query(
      "UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'closing'",
    );
    expect(await runAnnouncementsPublisherOnce()).toEqual({ published: 0 });
    const { rows } = await pool.query("SELECT fanned_out_at FROM announcements");
    expect(rows[0].fanned_out_at).toBeNull();
  });
});
