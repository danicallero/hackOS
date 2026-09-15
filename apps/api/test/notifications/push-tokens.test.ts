import "./env.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import { config } from "../../src/config.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUser } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/** Mobile push token registration (H4, H51, H55). */

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

afterEach(() => {
  config.logExpoPushTokens = false;
  config.logExpoPushUnsafeDebug = false;
  vi.restoreAllMocks();
});

describe("POST /api/me/push-tokens", () => {
  it("requires auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/push-tokens",
      payload: { token: "ExponentPushToken[a]" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("registers a token for the caller", async () => {
    const userId = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/me/push-tokens",
      headers: asUser(userId),
      payload: { token: "ExponentPushToken[a]", platform: "ios" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: true });

    const { rows } = await pool.query(
      `SELECT user_id, token, platform FROM push_tokens WHERE token = $1`,
      ["ExponentPushToken[a]"],
    );
    expect(rows).toEqual([{ user_id: userId, token: "ExponentPushToken[a]", platform: "ios" }]);
  });

  it("logs only a token hint when token logging is enabled", async () => {
    const userId = await createUser();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    config.logExpoPushTokens = true;

    const res = await app.inject({
      method: "POST",
      url: "/api/me/push-tokens",
      headers: asUser(userId),
      payload: { token: "ExponentPushToken[secret-token]", platform: "android" },
    });

    expect(res.statusCode).toBe(200);
    expect(info).toHaveBeenCalledWith("Expo push token registered", {
      userId,
      platform: "android",
      tokenHint: "…t-token]",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("ExponentPushToken[secret-token]");
  });

  it("logs the complete token only in unsafe debug mode", async () => {
    const userId = await createUser();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    config.logExpoPushUnsafeDebug = true;

    const res = await app.inject({
      method: "POST",
      url: "/api/me/push-tokens",
      headers: asUser(userId),
      payload: { token: "ExponentPushToken[full-debug-token]", platform: "android" },
    });

    expect(res.statusCode).toBe(200);
    expect(warn).toHaveBeenCalledWith("Expo push token registered (unsafe debug)", {
      userId,
      platform: "android",
      token: "ExponentPushToken[full-debug-token]",
    });
  });

  it("re-registering the same token is idempotent, not a duplicate row", async () => {
    const userId = await createUser();
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/me/push-tokens",
        headers: asUser(userId),
        payload: { token: "ExponentPushToken[b]" },
      });
      expect(res.statusCode).toBe(200);
    }

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM push_tokens WHERE token = $1`,
      ["ExponentPushToken[b]"],
    );
    expect(rows[0].n).toBe(1);
  });

  it("a token re-registered by a different user is reassigned (shared/reset device)", async () => {
    const userA = await createUser();
    const userB = await createUser();

    await app.inject({
      method: "POST",
      url: "/api/me/push-tokens",
      headers: asUser(userA),
      payload: { token: "ExponentPushToken[shared]" },
    });
    await app.inject({
      method: "POST",
      url: "/api/me/push-tokens",
      headers: asUser(userB),
      payload: { token: "ExponentPushToken[shared]" },
    });

    const { rows } = await pool.query(`SELECT user_id FROM push_tokens WHERE token = $1`, [
      "ExponentPushToken[shared]",
    ]);
    expect(rows).toEqual([{ user_id: userB }]);
  });
});
