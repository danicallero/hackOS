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
  });

  it("falls back to English for an unsupported language", async () => {
    const userId = await createUser({ email: "remi@test.local" });
    await setUserLanguage(userId, "fr");
    await enqueueOutbox(userId, "email", { template: "auth.reset", vars: { name: "Remi" } });

    await drainOutboxOnce();
    const messages = await waitForMailpit(1);
    expect(messages[0]!.Subject).toBe("Reset your hackOS password");
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
