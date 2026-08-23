import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import { config } from "../../src/config.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/**
 * H50 extension: schedule items reuse the announcements translate provider
 * boundary (modules/notifications/translate/), but content-scoped and with
 * primary_language auto-set from the author's own account language rather
 * than a picker. Google Translate is stubbed via `global.fetch`, mirroring
 * announcements-translate.test.ts; no live network call.
 */

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
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

function stubTranslateFetch() {
  const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      target: string;
      q: string[];
      source?: string;
    };
    expect(body.source).toBeUndefined(); // "auto" source is omitted entirely for Google
    const suffix = body.target.toUpperCase();
    return new Response(
      JSON.stringify({
        data: { translations: body.q.map((text) => ({ translatedText: `${text} [${suffix}]` })) },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("schedule translate-availability (H50 extension)", () => {
  it("is gated by SCHEDULE_MANAGE", async () => {
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/schedule/translate-availability",
      headers: asUser(await createUser()),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("reports unavailable when no provider is configured", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await app.inject({
      method: "GET",
      url: "/api/schedule/translate-availability",
      headers: asUser(adminId),
    });
    expect(res.json()).toEqual({ available: false });
  });

  it("reports available once GOOGLE_TRANSLATE_API_KEY is set", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    config.GOOGLE_TRANSLATE_API_KEY = "test-key";
    const res = await app.inject({
      method: "GET",
      url: "/api/schedule/translate-availability",
      headers: asUser(adminId),
    });
    expect(res.json()).toEqual({ available: true });
  });
});

describe("POST /api/schedule/translate (content-scoped)", () => {
  it("translates title+description without persisting or requiring an id", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    config.GOOGLE_TRANSLATE_API_KEY = "test-key";
    const fetchMock = stubTranslateFetch();

    const res = await app.inject({
      method: "POST",
      url: "/api/schedule/translate",
      headers: asUser(adminId),
      payload: {
        title: "Ceremonia de apertura",
        description: "Bienvenida al hackathon",
        targetLanguages: ["gl", "en"],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      gl: { title: "Ceremonia de apertura [GL]", description: "Bienvenida al hackathon [GL]" },
      en: { title: "Ceremonia de apertura [EN]", description: "Bienvenida al hackathon [EN]" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/schedule",
      headers: asUser(adminId),
    });
    expect(listRes.json().items).toEqual([]);
  });

  it("returns 503 when unconfigured", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await app.inject({
      method: "POST",
      url: "/api/schedule/translate",
      headers: asUser(adminId),
      payload: { title: "t", targetLanguages: ["en"] },
    });
    expect(res.statusCode).toBe(503);
  });
});

describe("creating a schedule item auto-translates (H50 extension)", () => {
  it("anchors primary_language to the author's own account language and fills the other two", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    await pool.query(`UPDATE users SET language = 'es' WHERE id = $1`, [adminId]);
    config.GOOGLE_TRANSLATE_API_KEY = "test-key";
    stubTranslateFetch();

    const res = await app.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(adminId),
      payload: {
        title: "Ceremonia de apertura",
        description: "Bienvenida al hackathon",
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 7_200_000).toISOString(),
        visibility: "hidden",
        audiences: [],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.primaryLanguage).toBe("es");
    expect(body.titleI18n).toEqual({
      gl: "Ceremonia de apertura [GL]",
      en: "Ceremonia de apertura [EN]",
    });
    expect(body.descriptionI18n).toEqual({
      gl: "Bienvenida al hackathon [GL]",
      en: "Bienvenida al hackathon [EN]",
    });
  });

  it("still creates the item when no provider is configured, with blank translations", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);

    const res = await app.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(adminId),
      payload: {
        title: "Untranslated item",
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 7_200_000).toISOString(),
        visibility: "hidden",
        audiences: [],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().titleI18n).toEqual({});
  });
});

describe("PUT /api/schedule/:id/translations (manual save)", () => {
  it("persists hand-edited text and mirrors it onto the linked activity", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const created = await app.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(adminId),
      payload: {
        title: "Manual item",
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 7_200_000).toISOString(),
        visibility: "hidden",
        audiences: [],
      },
    });
    const id = created.json().id;

    const res = await app.inject({
      method: "PUT",
      url: `/api/schedule/${id}/translations`,
      headers: asUser(adminId),
      payload: { translations: { en: { title: "Manual item (EN)" } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().titleI18n).toEqual({ en: "Manual item (EN)" });

    const { rows } = await pool.query(`SELECT name_i18n FROM activities WHERE schedule_id = $1`, [
      id,
    ]);
    expect(rows[0].name_i18n).toEqual({ en: "Manual item (EN)" });
  });
});
