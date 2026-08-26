import "./env.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/pool.js";
import { drainOutboxOnce } from "../../src/modules/notifications/dispatcher.js";
import { createUser } from "../helpers.js";
import { enqueueOutbox, getOutboxRow, resetNotificationsState } from "./notif-helpers.js";

/** Expo Push channel (H51, H55) — always via stubbed fetch, never live. */

beforeEach(async () => {
  await resetNotificationsState();
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

async function addPushToken(userId: number, token: string): Promise<void> {
  await pool.query(`INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)`, [userId, token]);
}

describe("push channel", () => {
  it("sends one batched Expo request to all of the user's tokens", async () => {
    const userId = await createUser();
    await addPushToken(userId, "ExponentPushToken[aaa]");
    await addPushToken(userId, "ExponentPushToken[bbb]");
    const id = await enqueueOutbox(userId, "push", {
      template: "queue.called",
      vars: { roomName: "Sala 1", teamName: "Rocket", challengeName: "General" },
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ status: "ok" }, { status: "ok" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await drainOutboxOnce();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    const messages = JSON.parse(init.body) as {
      to: string;
      title: string;
      body: string;
      channelId: string;
    }[];
    expect(messages.map((m) => m.to).sort()).toEqual([
      "ExponentPushToken[aaa]",
      "ExponentPushToken[bbb]",
    ]);
    expect(messages[0]!.title).toBe("Go wait at room Sala 1");
    expect(messages[0]!.body).toBe("Wait at the door for General. We'll tell you when to enter.");
    expect(messages[0]!.channelId).toBe("default");
    expect((await getOutboxRow(id)).status).toBe("sent");
  });

  it("puts the enter-now action and room in the notification header", async () => {
    const userId = await createUser();
    await addPushToken(userId, "ExponentPushToken[enter]");
    await enqueueOutbox(
      userId,
      "push",
      {
        template: "queue.enter",
        vars: { roomName: "Sala 2", challengeName: "Sustainability" },
      },
      "queue",
    );

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ status: "ok" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await drainOutboxOnce();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const [message] = JSON.parse(init.body) as { title: string; body: string }[];
    expect(message).toMatchObject({
      title: "Enter room Sala 2 now",
      body: "It's your team's turn for Sustainability.",
    });
  });

  it("uses compact, ready-to-act copy for pre-call notifications (H38)", async () => {
    const userId = await createUser();
    await addPushToken(userId, "ExponentPushToken[precall]");
    await enqueueOutbox(
      userId,
      "push",
      {
        template: "queue.precall",
        vars: { teamName: "Rocket", challengeName: "Sustainability", etaMinutes: "8" },
      },
      "queue",
    );

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ status: "ok" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await drainOutboxOnce();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const [message] = JSON.parse(init.body) as { title: string; body: string }[];
    expect(message).toMatchObject({
      title: "You're up soon — get ready",
      body: "Your team Rocket will be called for Sustainability in about 8 minutes.",
    });
  });

  it("includes category and template in the push data payload for client-side routing", async () => {
    const userId = await createUser();
    await addPushToken(userId, "ExponentPushToken[ccc]");
    await enqueueOutbox(
      userId,
      "push",
      {
        template: "queue.called",
        vars: { roomName: "Sala 1", teamName: "Rocket", challengeName: "General" },
      },
      "queue",
    );

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ status: "ok" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await drainOutboxOnce();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const messages = JSON.parse(init.body) as {
      data: Record<string, unknown>;
      priority: string;
      interruptionLevel: string;
      sound: string;
    }[];
    expect(messages[0]!.data).toMatchObject({
      category: "queue",
      template: "queue.called",
      roomName: "Sala 1",
      teamName: "Rocket",
      challengeName: "General",
    });
    expect(messages[0]).toMatchObject({
      priority: "high",
      interruptionLevel: "time-sensitive",
      sound: "default",
    });
  });

  it("deletes DeviceNotRegistered tokens and still succeeds (token hygiene)", async () => {
    const userId = await createUser();
    await addPushToken(userId, "ExponentPushToken[alive]");
    await addPushToken(userId, "ExponentPushToken[dead]");
    const id = await enqueueOutbox(userId, "push", { subject: "s", body: "b" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const messages = JSON.parse(init?.body ?? "[]") as { to: string }[];
        const tickets = messages.map((m) =>
          m.to === "ExponentPushToken[dead]"
            ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
            : { status: "ok" },
        );
        return new Response(JSON.stringify({ data: tickets }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await drainOutboxOnce();

    expect((await getOutboxRow(id)).status).toBe("sent");
    const { rows } = await pool.query(`SELECT token FROM push_tokens WHERE user_id = $1`, [userId]);
    expect(rows.map((r) => r.token)).toEqual(["ExponentPushToken[alive]"]);
  });

  it("user without tokens is a no-op success, not a retry loop", async () => {
    const userId = await createUser();
    const id = await enqueueOutbox(userId, "push", { subject: "s", body: "b" });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await drainOutboxOnce();
    expect(result.sent).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getOutboxRow(id)).status).toBe("sent");
  });

  it("non-DeviceNotRegistered ticket errors are retried with backoff", async () => {
    const userId = await createUser();
    await addPushToken(userId, "ExponentPushToken[throttled]");
    const id = await enqueueOutbox(userId, "push", { subject: "s", body: "b" });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  status: "error",
                  message: "rate limited",
                  details: { error: "MessageRateExceeded" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await drainOutboxOnce();
    const row = await getOutboxRow(id);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    // Persist only the provider's stable error code; the human-readable body
    // may contain token/request data.
    expect(row.last_error).toContain("MessageRateExceeded");
    expect(row.last_error).not.toContain("rate limited");
    // token kept — only DeviceNotRegistered removes it
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM push_tokens`);
    expect(rows[0].n).toBe(1);
  });

  it("a partial batch failure counts as delivered, so it is not resent to the tokens that already got it", async () => {
    const userId = await createUser();
    await addPushToken(userId, "ExponentPushToken[ok]");
    await addPushToken(userId, "ExponentPushToken[throttled]");
    const id = await enqueueOutbox(userId, "push", { subject: "s", body: "b" });

    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const messages = JSON.parse(init?.body ?? "[]") as { to: string }[];
      const tickets = messages.map((m) =>
        m.to === "ExponentPushToken[throttled]"
          ? { status: "error", message: "rate limited", details: { error: "MessageRateExceeded" } }
          : { status: "ok" },
      );
      return new Response(JSON.stringify({ data: tickets }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await drainOutboxOnce();

    // Delivered to at least one device — row is done, not queued for a retry
    // that would resend the same push to the token that already got it.
    expect((await getOutboxRow(id)).status).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs only non-identifying provider metadata for a partial failure", async () => {
    const userId = await createUser();
    await pool.query(`INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)`, [
      userId,
      "ExponentPushToken[working-token]",
      "android",
    ]);
    await pool.query(`INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)`, [
      userId,
      "ExponentPushToken[failing-token]",
      "ios",
    ]);
    const id = await enqueueOutbox(userId, "push", { subject: "s", body: "b" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ status: "ok" }, { status: "error", message: "APNs credentials missing" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await drainOutboxOnce();

    expect((await getOutboxRow(id)).status).toBe("sent");
    expect(warn).toHaveBeenCalledWith("Expo push ticket failed", {
      category: "test",
      platform: "ios",
      errorCode: "provider_error",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(String(userId));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("failing-token");
  });
});
