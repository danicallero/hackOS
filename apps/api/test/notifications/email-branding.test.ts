import "./env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { config } from "../../src/config.js";
import { pool } from "../../src/db/pool.js";
import { sendEmail } from "../../src/modules/notifications/channels/email.js";
import { renderEmailTemplate } from "../../src/modules/notifications/templates.js";
import { asUser, buildTestApp, createUserWithCapabilities } from "../helpers.js";
import { clearMailpit, getMailpitMessage, listMailpitMessages } from "./mailpit-helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/** Email layout and senders (H52): brand-correct logo, account vs notification sender, notice endpoint. */

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

beforeEach(async () => {
  await resetNotificationsState();
  await clearMailpit();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function waitForMessage() {
  const deadline = Date.now() + 5000;
  for (;;) {
    const [first] = await listMailpitMessages();
    if (first) return getMailpitMessage(first.ID);
    if (Date.now() > deadline) throw new Error("Mailpit: no message arrived");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("layout", () => {
  it("shows the cream logo on a navy band and never the red one", () => {
    const { html } = renderEmailTemplate({ template: "generic", subject: "s", body: "b" }, "en");
    expect(html).toContain("/email/hackudc-2027-dark.png");
    expect(html).not.toContain("/email/hackudc-2027.png");
    expect(html).toMatch(/class="email-head"[^>]*bgcolor="#030846"/);
  });
});

describe("senders", () => {
  it("sends account emails from the auth sender and the rest from the notifications sender", async () => {
    const mail = {
      provider: "smtp" as const,
      fromAddress: "notify@notify.example.org",
      fromName: "hackOS",
      authFromAddress: "no-reply@auth.example.org",
      authFromName: "hackOS accounts",
      replyTo: "help@example.org",
      smtpHost: config.SMTP_HOST,
      smtpPort: config.SMTP_PORT,
      smtpSecure: false,
      smtpRequireTls: false,
    };
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, language) VALUES ('who@test.local', 'Who', 'en') RETURNING id`,
    );
    const userId = rows[0].id as number;

    await sendEmail(
      pool,
      userId,
      { template: "auth.verify", vars: { name: "Who", verifyUrl: "http://x" } },
      mail,
    );
    const account = await waitForMessage();
    expect(account.From).toMatchObject({ Address: "no-reply@auth.example.org" });
    expect(account.ReplyTo[0]?.Address).toBe("help@example.org");

    await clearMailpit();
    await sendEmail(pool, userId, { template: "generic", subject: "Hi", body: "There" }, mail);
    const notice = await waitForMessage();
    expect(notice.From).toMatchObject({ Address: "notify@notify.example.org" });
  });
});

describe("POST /api/notifications/test-email", () => {
  it("requires the send capability", async () => {
    const { createUser } = await import("../helpers.js");
    const res = await app.inject({
      method: "POST",
      url: "/api/notifications/test-email",
      headers: { ...asUser(await createUser()), "idempotency-key": "t1" },
      payload: { to: "a@b.test", subject: "s", body: "b" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("delivers one branded notice to the address and audits it", async () => {
    const actor = await createUserWithCapabilities(["notifications:send"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/notifications/test-email",
      headers: { ...asUser(actor), "idempotency-key": "t2" },
      payload: {
        to: "dest@test.local",
        subject: "Prueba de entrega",
        body: "Hola, esto es una prueba.",
      },
    });
    expect(res.statusCode).toBe(200);

    const message = await waitForMessage();
    expect(message.Subject).toBe("Prueba de entrega");
    expect(message.From.Address).toBe(config.MAIL_FROM_ADDRESS);
    expect(message.HTML).toContain("Hola, esto es una prueba.");

    const { rows } = await pool.query(
      `SELECT action, actor_id FROM audit_log WHERE entity_type = 'email'`,
    );
    expect(rows).toEqual([{ action: "test_email_sent", actor_id: actor }]);
  });
});
