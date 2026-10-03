import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { drainOutboxOnce } from "../../src/modules/notifications/dispatcher.js";
import { notify } from "../../src/modules/notifications/service.js";
import { createUser } from "../helpers.js";
import { clearMailpit, getMailpitMessage, listMailpitMessages } from "./mailpit-helpers.js";
import {
  enqueueOutbox,
  getOutboxRow,
  resetNotificationsState,
  setUserLanguage,
} from "./notif-helpers.js";

/**
 * Email channel (H52): real SMTP delivery asserted through Mailpit's REST
 * API, i18n template selection from users.language, and generic fallback.
 */

beforeEach(async () => {
  await resetNotificationsState();
  await clearMailpit();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function waitForMailpit(count: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await listMailpitMessages();
    if (messages.length >= count) return messages;
    if (Date.now() > deadline) {
      throw new Error(`Mailpit: expected ${count} messages, got ${messages.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("SMTP via Mailpit (default dev provider)", () => {
  it("delivers a real branded email end-to-end through the dispatcher (H52)", async () => {
    const userId = await createUser({ email: "ada@test.local", name: "Ada" });
    const [id] = await notify(pool, {
      userId,
      category: "queue",
      channels: ["email"],
      payload: {
        template: "queue.called",
        vars: { name: "Ada", teamName: "Rocket", challengeName: "General", roomName: "Sala 3" },
      },
    });

    const result = await drainOutboxOnce();
    expect(result.sent).toBe(1);
    expect((await getOutboxRow(id as number)).status).toBe("sent");

    const messages = await waitForMailpit(1);
    expect(messages[0]!.Subject).toBe("Your team was called");
    expect(messages[0]!.To[0]!.Address).toBe("ada@test.local");

    const detail = await getMailpitMessage(messages[0]!.ID);
    expect(detail.Text).toContain("Sala 3");
    expect(detail.Text).toContain("Rocket");
    expect(detail.HTML).toContain("hackOS"); // branded wrapper
    expect(detail.HTML).toContain('<html lang="en">');
    expect(detail.HTML).toContain("This is an automated message.");
    expect(detail.Text).toContain("This is an automated message.");
    expect(detail.HTML).toContain("this address does not receive incoming messages");
    expect(detail.HTML).toContain('href="mailto:hackudc@gpul.org"');
  });

  it("selects the template language from users.language (gl), not the payload (i18n)", async () => {
    const userId = await createUser({ email: "breo@test.local" });
    await setUserLanguage(userId, "gl");
    await enqueueOutbox(
      userId,
      "email",
      { template: "queue.called", vars: { name: "Breo", roomName: "Sala 1" } },
      "queue",
    );

    await drainOutboxOnce();
    const messages = await waitForMailpit(1);
    expect(messages[0]!.Subject).toBe("Chamaron ao teu equipo");
    const detail = await getMailpitMessage(messages[0]!.ID);
    expect(detail.HTML).toContain('<html lang="gl">');
    expect(detail.HTML).toContain("Esta é unha mensaxe automática.");
  });

  it("falls back to English for an unsupported language", async () => {
    const userId = await createUser({ email: "remi@test.local" });
    await setUserLanguage(userId, "fr");
    await enqueueOutbox(userId, "email", { template: "auth.reset", vars: { name: "Remi" } });

    await drainOutboxOnce();
    const messages = await waitForMailpit(1);
    expect(messages[0]!.Subject).toBe("Reset your hackOS password");
  });

  it.each([
    ["es", "Lamentablemente", "Esperamos verte en próximas ediciones"],
    ["gl", "Lamentablemente", "Agardamos verte en próximas edicións"],
    ["en", "Unfortunately", "We hope to see you at a future edition"],
  ])("delivers a considerate rejection in %s without internal status keys (H14/H52)", async (language, outcome, closing) => {
    const userId = await createUser({ email: "applicant@test.local" });
    await setUserLanguage(userId, language);
    await enqueueOutbox(
      userId,
      "email",
      {
        template: "application.decision",
        vars: {
          name: "Ada",
          applicationName: "Participants",
          eventName: "HackUDC 2027",
          decision: "rejected",
          decisionDetails: "",
        },
      },
      "application",
    );
    await drainOutboxOnce();
    const messages = await waitForMailpit(1);
    const detail = await getMailpitMessage(messages[0]!.ID);
    expect(detail.Text).toContain(outcome);
    expect(detail.Text).toContain(closing);
    expect(detail.Text).toContain("HackUDC 2027");
    expect(detail.Text).toContain("Participants");
    expect(detail.Text).not.toContain("rejected");
    expect(detail.Text).not.toContain("{{");
    expect(detail.HTML).not.toContain("/applications/confirm");
    expect(messages[0]!.Subject).not.toContain("rejected");
  });

  it("unknown template falls back to generic rendering of the payload", async () => {
    const userId = await createUser({ email: "gen@test.local" });
    await enqueueOutbox(userId, "email", {
      template: "totally.unknown",
      subject: "Custom subject",
      body: "Custom body text",
    });

    await drainOutboxOnce();
    const messages = await waitForMailpit(1);
    expect(messages[0]!.Subject).toBe("Custom subject");
    const detail = await getMailpitMessage(messages[0]!.ID);
    expect(detail.Text).toContain("Custom body text");
  });

  it("payload.recipient and payload.language override the user row (H6/H10 flows)", async () => {
    // user row says English + their primary address; payload overrides both,
    // e.g. verifying a secondary email (H6) in the user's chosen language.
    const userId = await createUser({ email: "primary@test.local" });
    await setUserLanguage(userId, "en");
    await enqueueOutbox(
      userId,
      "email",
      {
        template: "auth.verify",
        language: "es",
        recipient: "secondary@test.local",
        vars: { name: "Ana", verifyUrl: "http://verify" },
      },
      "auth",
    );

    await drainOutboxOnce();
    const messages = await waitForMailpit(1);
    expect(messages[0]!.To[0]!.Address).toBe("secondary@test.local");
    expect(messages[0]!.Subject).toBe("Verifica tu correo de hackOS"); // es, not en
    const detail = await getMailpitMessage(messages[0]!.ID);
    expect(detail.Text).toContain("http://verify");
  });
});

describe("event reminder email (H28,H45,H52)", () => {
  it("delivers an embedded ticket image and the official Wallet artwork through SMTP", async () => {
    const { assignRole, createRole } = await import("../helpers.js");
    const userId = await createUser({ email: "reminder@test.local", name: "Ada" });
    await setUserLanguage(userId, "es");
    await assignRole(userId, await createRole([], { eventAccess: true }));
    await pool.query(
      "INSERT INTO event_config (id, name, timezone, event_starts_at) VALUES (1, 'HackUDC 2027', 'Europe/Madrid', '2027-02-19T17:00:00Z')",
    );
    const id = await enqueueOutbox(
      userId,
      "email",
      { template: "event.reminder" },
      "event.reminder",
    );
    expect((await drainOutboxOnce()).sent).toBe(1);
    expect((await getOutboxRow(id)).status).toBe("sent");
    const messages = await waitForMailpit(1);
    const firstMessage = messages[0];
    if (!firstMessage) throw new Error("Expected the event reminder in Mailpit");
    const message = await getMailpitMessage(firstMessage.ID);
    expect(message.Text).toContain("18:00 CET");
    expect(message.HTML).toContain('src="cid:event-ticket@hackos"');
    expect(message.HTML).toContain("apple-wallet-badge-es.png");
    expect(message.HTML).toContain("google-wallet-button-es.png");
    const raw = await (
      await fetch(`http://localhost:8025/api/v1/message/${firstMessage.ID}/raw`)
    ).text();
    expect(raw).toContain("Content-ID: <event-ticket@hackos>");
    expect(raw).toContain("Content-Type: image/png");
  });
  it("supersedes a queued reminder after event access is revoked", async () => {
    const userId = await createUser();
    const id = await enqueueOutbox(
      userId,
      "email",
      { template: "event.reminder" },
      "event.reminder",
    );
    expect((await drainOutboxOnce()).superseded).toBe(1);
    expect((await getOutboxRow(id)).status).toBe("superseded");
    expect(await listMailpitMessages()).toEqual([]);
  });
});
