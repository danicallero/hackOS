import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import { config } from "../../src/config.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUser, createUserWithCapabilities } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/**
 * H50 automatic translation: an isolated, entirely optional provider
 * boundary (modules/notifications/translate/) — see announcements.md.
 * Google Translate is stubbed via `global.fetch`, mirroring the Resend
 * email adapter's own test convention; no live network call.
 */

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

beforeEach(async () => {
  await resetNotificationsState();
});

afterEach(() => {
  config.TRANSLATE_PROVIDER = "google";
  config.GOOGLE_TRANSLATE_API_KEY = undefined;
  config.LIBRETRANSLATE_URL = undefined;
  config.LIBRETRANSLATE_API_KEY = undefined;
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("automatic translation availability", () => {
  it("reports unavailable when no provider is configured, guarded by ANNOUNCEMENTS_MANAGE", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);

    const anon = await app.inject({
      method: "GET",
      url: "/api/announcements/translate-availability",
    });
    expect(anon.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/announcements/translate-availability",
      headers: asUser(await createUser()),
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: "GET",
      url: "/api/announcements/translate-availability",
      headers: asUser(adminId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
  });

  it("reports available once GOOGLE_TRANSLATE_API_KEY is set", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    config.GOOGLE_TRANSLATE_API_KEY = "test-key";

    const res = await app.inject({
      method: "GET",
      url: "/api/announcements/translate-availability",
      headers: asUser(adminId),
    });
    expect(res.json()).toEqual({ available: true });
  });
});

describe("POST /api/announcements/translate", () => {
  it("returns 503 (never a raw provider error) when unconfigured — manual entry keeps working regardless", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements/translate",
      headers: asUser(adminId),
      payload: {
        title: "Dinner is ready",
        body: "Head to the canteen",
        sourceLanguage: "es",
        targetLanguages: ["gl", "en"],
      },
    });
    expect(res.statusCode).toBe(503);
  });

  it("translates title+body into each target language via the stubbed provider", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    config.GOOGLE_TRANSLATE_API_KEY = "test-key";

    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { target: string; q: string[] };
      const suffix = body.target.toUpperCase();
      return new Response(
        JSON.stringify({
          data: { translations: body.q.map((text) => ({ translatedText: `${text} [${suffix}]` })) },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements/translate",
      headers: asUser(adminId),
      payload: {
        title: "Dinner is ready",
        body: "Head to the canteen",
        sourceLanguage: "es",
        targetLanguages: ["gl", "en", "es"],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      translations: {
        gl: { title: "Dinner is ready [GL]", body: "Head to the canteen [GL]" },
        en: { title: "Dinner is ready [EN]", body: "Head to the canteen [EN]" },
      },
    });
    // Source language is skipped, never sent to the provider (it's already what it is).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("translates via a self-hosted LibreTranslate instance when TRANSLATE_PROVIDER=libretranslate", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    config.TRANSLATE_PROVIDER = "libretranslate";
    config.LIBRETRANSLATE_URL = "https://translate.example.org";
    config.LIBRETRANSLATE_API_KEY = "test-key";

    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      expect(url).toBe("https://translate.example.org/translate");
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        target: string;
        q: string[];
        api_key?: string;
      };
      expect(body.api_key).toBe("test-key");
      const suffix = body.target.toUpperCase();
      return new Response(
        JSON.stringify({ translatedText: body.q.map((text) => `${text} [${suffix}]`) }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements/translate",
      headers: asUser(adminId),
      payload: {
        title: "Dinner is ready",
        body: "Head to the canteen",
        sourceLanguage: "es",
        targetLanguages: ["gl"],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      translations: { gl: { title: "Dinner is ready [GL]", body: "Head to the canteen [GL]" } },
    });
  });

  it("bubbles up a clean error when the provider itself fails", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    config.GOOGLE_TRANSLATE_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota exceeded", { status: 429 })),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements/translate",
      headers: asUser(adminId),
      payload: {
        title: "t",
        body: "b",
        sourceLanguage: "es",
        targetLanguages: ["en"],
      },
    });
    expect(res.statusCode).toBe(500);
  });
});
