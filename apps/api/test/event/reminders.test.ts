import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool, withTransaction } from "../../src/db/pool.js";
import { prepareEventReminder } from "../../src/modules/event/reminder-email.js";
import { runEventRemindersOnce } from "../../src/modules/event/reminders.js";
import { SupersededDispatchError } from "../../src/modules/notifications/errors.js";
import { renderEmailTemplate } from "../../src/modules/notifications/templates.js";
import {
  assignRole,
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

let app: App;
beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  await pool.query(
    "INSERT INTO event_config (id, name, timezone, event_starts_at) VALUES (1, 'HackUDC 2027', 'Europe/Madrid', now() + interval '7 days')",
  );
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
async function request(userId: number, scheduledAt: string | null, key = crypto.randomUUID()) {
  app ??= await buildTestApp();
  return app.inject({
    method: "PUT",
    url: "/api/event",
    headers: { ...asUser(userId), "Idempotency-Key": key },
    payload: { eventReminderScheduledAt: scheduledAt },
  });
}
async function due() {
  await pool.query(
    "INSERT INTO event_email_reminders (scheduled_at) VALUES (now() - interval '1 minute')",
  );
}

describe("scheduled event-access reminder (H45,H52)", () => {
  it("requires event management and a future send before doors open", async () => {
    const nobody = await createUser();
    expect((await request(nobody, new Date(Date.now() + 86400000).toISOString())).statusCode).toBe(
      403,
    );
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    for (const offset of [-1000, 8 * 86400000])
      expect((await request(manager, new Date(Date.now() + offset).toISOString())).statusCode).toBe(
        400,
      );
    await pool.query("UPDATE event_config SET event_starts_at = NULL");
    expect((await request(manager, new Date(Date.now() + 86400000).toISOString())).statusCode).toBe(
      400,
    );
  });
  it("rolls back event edits when scheduling fails and enforces the field capability", async () => {
    app ??= await buildTestApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/event",
      headers: { ...asUser(manager), "Idempotency-Key": crypto.randomUUID() },
      payload: {
        name: "Should roll back",
        eventReminderScheduledAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await pool.query("SELECT name FROM event_config WHERE id = 1")).rows[0].name).toBe(
      "HackUDC 2027",
    );
    expect(
      (await pool.query("SELECT id FROM audit_log WHERE entity_type = 'event_config'")).rowCount,
    ).toBe(0);
    const venueManager = await createUserWithCapabilities([CAPABILITIES.VENUE_MANAGE]);
    expect(
      (await request(venueManager, new Date(Date.now() + 86400000).toISOString())).statusCode,
    ).toBe(403);
  });
  it("schedules idempotently, replaces and cancels with transactional audit", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const key = crypto.randomUUID();
    const time = new Date(Date.now() + 86400000).toISOString();
    expect((await request(manager, time, key)).statusCode).toBe(200);
    const replay = await request(manager, time, key);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    await request(manager, new Date(Date.now() + 2 * 86400000).toISOString());
    expect(
      (await pool.query("SELECT id FROM event_email_reminders WHERE status = 'scheduled'"))
        .rowCount,
    ).toBe(1);
    await request(manager, null);
    expect(
      (await pool.query("SELECT id FROM event_email_reminders WHERE status = 'scheduled'"))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT id FROM audit_log WHERE entity_type = 'event_email_reminder'"))
        .rowCount,
    ).toBe(3);
    expect(await runEventRemindersOnce()).toBe(0);
  });
  it("fan-outs once under concurrent ticks to every active real event-access holder", async () => {
    const role = await createRole([], { eventAccess: true });
    const attendee = await createUser();
    const staff = await createUser();
    const synthetic = await createUser();
    const closed = await createUser();
    const applicant = await createUser();
    for (const id of [attendee, staff, synthetic, closed]) await assignRole(id, role);
    await assignRole(attendee, await createRole([], { eventAccess: true }));
    await pool.query("UPDATE users SET is_test_account = true WHERE id = $1", [synthetic]);
    await pool.query("UPDATE users SET account_state = 'removal_pending' WHERE id = $1", [closed]);
    await due();
    const counts = await Promise.all([runEventRemindersOnce(), runEventRemindersOnce()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    const rows = await pool.query(
      "SELECT user_id, channel, payload FROM notification_outbox ORDER BY user_id",
    );
    expect(rows.rows.map((r) => r.user_id)).toEqual([attendee, staff]);
    expect(
      rows.rows.every((r) => r.channel === "email" && r.payload.template === "event.reminder"),
    ).toBe(true);
    expect(rows.rows.some((r) => r.user_id === applicant)).toBe(false);
    expect(await runEventRemindersOnce()).toBe(0);
  });
  it("does not send early or after the event has opened", async () => {
    await pool.query(
      "INSERT INTO event_email_reminders (scheduled_at) VALUES (now() + interval '1 day')",
    );
    expect(await runEventRemindersOnce()).toBe(0);
    await pool.query("UPDATE event_email_reminders SET scheduled_at = now() - interval '1 minute'");
    await pool.query("UPDATE event_config SET event_starts_at = now() - interval '1 minute'");
    expect(await runEventRemindersOnce()).toBe(0);
    expect((await pool.query("SELECT status FROM event_email_reminders")).rows[0].status).toBe(
      "expired",
    );
  });
  it.each([
    "es",
    "gl",
    "en",
  ])("renders %s locally with official badges and a permanent ticket QR", async (language) => {
    const userId = await createUser({ name: "Ada" });
    await assignRole(userId, await createRole([], { eventAccess: true }));
    await pool.query("UPDATE event_config SET event_starts_at = '2027-02-19T17:00:00Z'");
    const mail = await withTransaction((db) =>
      prepareEventReminder(db, userId, language, { template: "event.reminder" }),
    );
    expect(mail.attachment.content.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(mail.payload.vars.checkInTime).toContain("18:00");
    const rendered = renderEmailTemplate(mail.payload, language as "es" | "gl" | "en");
    const suffix = language === "en" ? "en" : "es";
    expect(rendered.html).toContain(`apple-wallet-badge-${suffix}.png`);
    expect(rendered.html).toContain(`google-wallet-button-${suffix}.png`);
    expect(rendered.html).toContain('src="cid:event-ticket@hackos"');
    expect(rendered.html.indexOf('src="cid:event-ticket@hackos"')).toBeLessThan(
      rendered.html.indexOf(`apple-wallet-badge-${suffix}.png`),
    );
    expect(rendered.text).toContain("/wallet?add=apple");
    const ticket = (await pool.query("SELECT token FROM tickets WHERE user_id = $1", [userId]))
      .rows[0].token;
    await withTransaction((db) =>
      prepareEventReminder(db, userId, language, { template: "event.reminder" }),
    );
    expect(
      (await pool.query("SELECT token FROM tickets WHERE user_id = $1", [userId])).rows[0].token,
    ).toBe(ticket);
    await pool.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
    await expect(
      prepareEventReminder(pool, userId, language, { template: "event.reminder" }),
    ).rejects.toBeInstanceOf(SupersededDispatchError);
  });
});
