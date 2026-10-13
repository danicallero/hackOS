import { describe, expect, it } from "vitest";
import type { Translate } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import {
  buildScheduleCsv,
  defaultExportColumns,
  scheduleCsvFilename,
  scheduleExportTitle,
  scheduleExportValue,
} from "./schedule-export";
import {
  DEFAULT_COLUMN_ORDER,
  REQUIRED_COLUMNS,
  sanitizeTableConfig,
} from "./schedule-table-config";

// H48/H59 + #966: roster CSV export and the Live Activity column.

const t = ((key: string) => key) as Translate;
const ctx = {
  t,
  language: "en" as const,
  timeZone: "UTC",
  now: Date.parse("2026-07-22T12:00:00Z"),
};

function item(overrides: Partial<PublicScheduleItem> = {}): PublicScheduleItem {
  return {
    id: 1,
    title: "Workshop",
    description: null,
    location: null,
    type: "workshop",
    requiresScan: false,
    startsAt: "2026-07-22T13:00:00.000Z",
    endsAt: "2026-07-22T14:30:00.000Z",
    visibility: "shown",
    publishAt: null,
    audiences: ["participant", "mentor"],
    primaryLanguage: "es",
    titleI18n: {},
    descriptionI18n: {},
    ...overrides,
  };
}

describe("liveActivity column config", () => {
  it("is in the default order and hideable", () => {
    expect(DEFAULT_COLUMN_ORDER).toContain("liveActivity");
    expect(REQUIRED_COLUMNS).not.toContain("liveActivity");
  });

  it("is appended for saved configs from before the column existed", () => {
    const saved = DEFAULT_COLUMN_ORDER.filter((id) => id !== "liveActivity");
    const config = sanitizeTableConfig({ order: saved, hidden: ["liveActivity"] });
    expect(config?.order).toContain("liveActivity");
    expect(config?.hidden).toEqual(["liveActivity"]);
    expect(config?.widths.liveActivity).toBeGreaterThan(0);
  });
});

describe("defaultExportColumns", () => {
  it("is the visible columns in their current order", () => {
    const config = sanitizeTableConfig({
      order: ["item", ...DEFAULT_COLUMN_ORDER.filter((id) => id !== "item")],
      hidden: ["starts", "notes"],
    });
    const columns = defaultExportColumns(config!);
    expect(columns[0]).toBe("item");
    expect(columns).not.toContain("starts");
    expect(columns).not.toContain("notes");
    expect(columns).toHaveLength(DEFAULT_COLUMN_ORDER.length - 2);
  });
});

describe("scheduleExportValue", () => {
  it("renders booleans as localized yes/no", () => {
    expect(scheduleExportValue(item({ liveActivityAudience: true }), "liveActivity", ctx)).toBe(
      "yesLabel",
    );
    expect(scheduleExportValue(item(), "liveActivity", ctx)).toBe("noLabel");
    expect(scheduleExportValue(item({ requiresScan: true }), "scannable", ctx)).toBe("yesLabel");
  });

  it("renders readable dates, audiences, owners and staff-only", () => {
    expect(scheduleExportValue(item(), "starts", ctx)).toBe("22/07/2026, 13:00");
    expect(scheduleExportValue(item(), "duration", ctx)).toBe("1:30");
    expect(scheduleExportValue(item(), "publishAt", ctx)).toBe("");
    expect(scheduleExportValue(item(), "audience", ctx)).toBe(
      "audienceParticipant, audienceMentor",
    );
    expect(scheduleExportValue(item({ audiences: [] }), "audience", ctx)).toBe(
      "audienceFilterStaffOnly",
    );
    expect(
      scheduleExportValue(
        item({
          owners: [
            { id: 1, userId: 1, name: "Ana", surname: "Paz", freeTextName: null },
            { id: 2, userId: null, name: null, surname: null, freeTextName: "Catering" },
          ],
        }),
        "owners",
        ctx,
      ),
    ).toBe("Ana Paz, Catering");
  });
});

describe("scheduleExportTitle", () => {
  it("uses the viewer's language, then English, then the authored text", () => {
    const i = item({ title: "Taller", titleI18n: { en: "Workshop", gl: "Obradoiro" } });
    expect(scheduleExportTitle(i, "es")).toBe("Taller");
    expect(scheduleExportTitle(i, "gl")).toBe("Obradoiro");
    expect(
      scheduleExportTitle(item({ title: "Taller", titleI18n: { en: "Workshop" } }), "gl"),
    ).toBe("Workshop");
    expect(scheduleExportTitle(item({ title: "Taller" }), "gl")).toBe("Taller");
  });
});

describe("buildScheduleCsv", () => {
  it("writes a header of column labels and escapes cells, in the given column order", () => {
    const csv = buildScheduleCsv(
      [
        item({ title: 'Say "hi", team', notes: "line1\nline2", liveActivityAudience: true }),
        item({ id: 2, title: "Plain", primaryLanguage: "en" }),
      ],
      ["item", "liveActivity", "notes"],
      ctx,
    );
    expect(csv).toBe(
      "﻿colItem,scheduleLiveActivityColumn,notesLabel\r\n" +
        '"Say ""hi"", team",yesLabel,"line1\nline2"\r\n' +
        "Plain,noLabel,\r\n",
    );
  });
});

describe("scheduleCsvFilename", () => {
  it("is dated with the local day", () => {
    expect(scheduleCsvFilename(new Date(2026, 6, 5))).toBe("schedule-2026-07-05.csv");
  });
});
