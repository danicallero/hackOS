import "./env.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/pool.js";
import type { MailConfig } from "../../src/modules/notifications/channels/email.js";
import { sendEmail } from "../../src/modules/notifications/channels/email.js";
import { drainOutboxOnce } from "../../src/modules/notifications/dispatcher.js";
import { notify } from "../../src/modules/notifications/service.js";
import {
  emailLayoutSettingsFromConfig,
  renderEmailTemplate,
} from "../../src/modules/notifications/templates.js";
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
 * API, i18n template selection from users.language, generic fallback, and
 * the Resend/Postal HTTP adapters via stubbed fetch.
 */

beforeEach(async () => {
  await resetNotificationsState();
  await clearMailpit();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe("template renderer layout settings", () => {
  it("supports build-time-style footer customization from settings (H52)", () => {
    const customLayout = {
      ...emailLayoutSettingsFromConfig(),
      footerText:
        "You are receiving this automated email because your account has notifications enabled.\nYou may request your data removal at privacy@hackos.example.",
    };
    const rendered = renderEmailTemplate(
      { template: "generic", subject: "Subject", body: "Body text" },
      "en",
      customLayout,
    );

    expect(rendered.html).toContain(
      "You are receiving this automated email because your account has notifications enabled.",
    );
    expect(rendered.html).toContain("You may request your data removal at privacy@hackos.example.");
  });
});

describe("HTTP provider adapters (stubbed fetch)", () => {
  const baseMail: MailConfig = {
    provider: "smtp",
    fromAddress: "noreply@hackos.local",
    fromName: "hackOS",
    smtpHost: "localhost",
    smtpPort: 1025,
  };

  it("resend adapter posts to the Resend API with the configured key", async () => {
    const userId = await createUser({ email: "resend@test.local" });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(
      pool,
      userId,
      { template: "auth.verify", vars: { verifyUrl: "http://x" } },
      {
        ...baseMail,
        provider: "resend",
        resendApiKey: "re-key-123",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re-key-123");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["resend@test.local"]);
    expect(body.subject).toBe("Verify your hackOS email");
    expect(body.html).toContain("http://x");
  });

  it("postal adapter posts to the configured self-hosted server", async () => {
    const userId = await createUser({ email: "postal@test.local" });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status: "success" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(
      pool,
      userId,
      { template: "auth.invite", vars: { claimUrl: "http://claim" } },
      {
        ...baseMail,
        provider: "postal",
        postalUrl: "https://postal.example.org/",
        postalApiKey: "postal-key",
      },
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://postal.example.org/api/v1/send/message");
    expect(init.headers["X-Server-API-Key"]).toBe("postal-key");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["postal@test.local"]);
    expect(body.plain_body).toContain("http://claim");
  });

  it("provider misconfiguration surfaces as a retryable error, not a silent drop", async () => {
    const userId = await createUser();
    await expect(
      sendEmail(pool, userId, { subject: "s", body: "b" }, { ...baseMail, provider: "resend" }),
    ).rejects.toThrow(/RESEND_API_KEY/);

    const fetchMock = vi.fn(
      async () => new Response("recipient primary@test.local request=private", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendEmail(
        pool,
        userId,
        { subject: "s", body: "b" },
        { ...baseMail, provider: "resend", resendApiKey: "bad" },
      ),
    ).rejects.toThrow(/401/);
    await expect(
      sendEmail(
        pool,
        userId,
        { subject: "s", body: "b" },
        { ...baseMail, provider: "resend", resendApiKey: "bad" },
      ),
    ).rejects.not.toThrow(/primary@test.local|recipient|email/i);
  });
});
