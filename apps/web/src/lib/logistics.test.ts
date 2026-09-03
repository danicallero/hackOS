import { afterEach, describe, expect, it, vi } from "vitest";
import { logisticsApi, type PublicScheduleItem, resolveScheduleText } from "./logistics";

function item(overrides: Partial<PublicScheduleItem> = {}): PublicScheduleItem {
  return {
    id: 1,
    title: "Título base",
    description: "Descripción base",
    location: null,
    type: "activity",
    startsAt: "2026-08-23T10:00:00.000Z",
    endsAt: "2026-08-23T11:00:00.000Z",
    publishAt: null,
    primaryLanguage: "es",
    titleI18n: {},
    descriptionI18n: {},
    ...overrides,
  };
}

describe("logisticsApi.publicSchedule", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits credentials for the venue TV so a staff session cookie never widens the projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await logisticsApi.publicSchedule({ anonymous: true });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("keeps the caller's session by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await logisticsApi.publicSchedule();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: "include" }),
    );
  });
});

describe("resolveScheduleText", () => {
  it("resolves translated descriptions independently from titles", () => {
    expect(
      resolveScheduleText(item({ descriptionI18n: { gl: "Descrición en galego" } }), "gl"),
    ).toEqual({ title: "Título base", description: "Descrición en galego" });
  });

  it("falls back per field through English and the canonical content", () => {
    expect(
      resolveScheduleText(
        item({
          titleI18n: { gl: "Título galego" },
          descriptionI18n: { en: "English description" },
        }),
        "gl",
      ),
    ).toEqual({ title: "Título galego", description: "English description" });
  });
});
