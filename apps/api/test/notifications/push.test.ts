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
    const messages = JSON.parse(init.body) as { to: string; title: string }[];
    expect(messages.map((m) => m.to).sort()).toEqual([
      "ExponentPushToken[aaa]",
      "ExponentPushToken[bbb]",
    ]);
    expect(messages[0]!.title).toBe("Your team was called");
    expect((await getOutboxRow(id)).status).toBe("sent");
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
    const messages = JSON.parse(init.body) as { data: Record<string, unknown> }[];
    expect(messages[0]!.data).toMatchObject({
      category: "queue",
      template: "queue.called",
      roomName: "Sala 1",
      teamName: "Rocket",
      challengeName: "General",
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
    expect(row.last_error).toContain("rate limited");
    // token kept — only DeviceNotRegistered removes it
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM push_tokens`);
    expect(rows[0].n).toBe(1);
  });
});
