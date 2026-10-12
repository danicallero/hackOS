// H48/H59: CSV export of the staff schedule roster. Values are the human-readable
// ones the table shows (localized times, audience names, yes/no), not raw ids.

import { buildCsv } from "@/lib/csv";
import { getEventTimeZone } from "@/lib/event-time";
import { LOCALE_CODES, type Translate } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import type { Language } from "@/lib/types";
import {
  ownerNames,
  SCHEDULE_AUDIENCES,
  scheduleAudienceLabel,
  scheduleDuration,
  scheduleStatus,
  scheduleStatusLabel,
  scheduleTypeLabel,
} from "./schedule-model";
import { COLUMN_LABEL_KEYS, type ColumnId, type TableConfig } from "./schedule-table-config";

export interface ScheduleExportContext {
  t: Translate;
  language: Language;
  /** IANA zone; omitted means the event's, which is what the roster displays (H45/H47). */
  timeZone?: string;
  now?: number;
}

/** Visible columns in their current order — the export dialog's pre-selection. */
export function defaultExportColumns(config: TableConfig): ColumnId[] {
  return config.order.filter((id) => !config.hidden.includes(id));
}

export function scheduleCsvFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `schedule-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/** Title in the viewer's language, else English, else the authored text. */
export function scheduleExportTitle(item: PublicScheduleItem, language: Language): string {
  if (item.primaryLanguage === language) return item.title;
  return (
    item.titleI18n?.[language] ||
    (item.primaryLanguage === "en" ? item.title : item.titleI18n?.en) ||
    item.title
  );
}

function dateTime(iso: string | null, ctx: ScheduleExportContext): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE_CODES[ctx.language], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ctx.timeZone ?? getEventTimeZone(),
  }).format(date);
}

export function scheduleExportValue(
  item: PublicScheduleItem,
  column: ColumnId,
  ctx: ScheduleExportContext,
): string {
  const { t, language } = ctx;
  const yesNo = (value: boolean) => (value ? t("yesLabel") : t("noLabel"));
  switch (column) {
    case "status":
      return scheduleStatusLabel(scheduleStatus(item, ctx.now), t);
    case "starts":
      return dateTime(item.startsAt, ctx);
    case "ends":
      return dateTime(item.endsAt, ctx);
    case "duration":
      return scheduleDuration(item.startsAt, item.endsAt);
    case "type":
      return item.type ? scheduleTypeLabel(item.type, t) : "";
    case "audience": {
      const audiences = SCHEDULE_AUDIENCES.filter((a) => (item.audiences ?? []).includes(a));
      return audiences.length === 0
        ? t("audienceFilterStaffOnly")
        : audiences.map((a) => scheduleAudienceLabel(a, t)).join(", ");
    }
    case "scannable":
      return yesNo(item.requiresScan === true);
    case "liveActivity":
      return yesNo(item.liveActivityAudience === true);
    case "publishAt":
      return dateTime(item.publishAt ?? null, ctx);
    case "location":
      return item.location ?? "";
    case "item":
      return scheduleExportTitle(item, language);
    case "owners":
      return ownerNames(item);
    case "notes":
      return item.notes ?? "";
  }
}

export function buildScheduleCsv(
  items: PublicScheduleItem[],
  columns: ColumnId[],
  ctx: ScheduleExportContext,
): string {
  return buildCsv([
    columns.map((id) => ctx.t(COLUMN_LABEL_KEYS[id])),
    ...items.map((item) => columns.map((id) => scheduleExportValue(item, id, ctx))),
  ]);
}
