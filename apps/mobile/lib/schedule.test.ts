jest.mock("./api", () => ({ apiFetch: jest.fn() }));

import { resolveScheduleText, type ScheduleItem, upsertScheduleItem } from "./schedule";

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 1,
    title: "Título base",
    description: "Descripción base",
    location: null,
    type: "activity",
    startsAt: "2026-08-23T10:00:00.000Z",
    endsAt: "2026-08-23T11:00:00.000Z",
    audiences: [],
    primaryLanguage: "es",
    titleI18n: {},
    descriptionI18n: {},
    ...overrides,
  };
}

describe("resolveScheduleText", () => {
  it("keeps a translated description when only the title translation is missing", () => {
    expect(
      resolveScheduleText(item({ descriptionI18n: { gl: "Descrición en galego" } }), "gl"),
    ).toEqual({ title: "Título base", description: "Descrición en galego" });
  });

  it("falls back per field instead of hiding the canonical description", () => {
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

describe("upsertScheduleItem", () => {
  it("replaces the saved item in the schedule snapshot", () => {
    const updated = item({ title: "Título actualizado" });

    expect(upsertScheduleItem([item()], updated)).toEqual([updated]);
  });

  it("adds a newly created item when it is not in the snapshot", () => {
    const created = item({ id: 2, title: "Nuevo horario" });

    expect(upsertScheduleItem([item()], created)).toEqual([item(), created]);
  });
});
