import { apiFetch } from "./api";
import type { useLocale } from "./i18n";
import { durationMinutes } from "./presence-timeline";

type Translate = ReturnType<typeof useLocale>["t"];

export interface ScheduleItem {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  startsAt: string;
  endsAt: string;
}

export async function fetchPublicSchedule(): Promise<ScheduleItem[]> {
  const response = await apiFetch<{ items: ScheduleItem[] }>("/api/public/activities");
  return response.items;
}

export function scheduleTypeLabel(type: string | null | undefined, t: Translate): string {
  const labels: Record<string, string> = {
    activity: t("typeActivity"),
    meal: t("typeMeal"),
    workshop: t("typeWorkshop"),
    talk: t("typeTalk"),
    ceremony: t("typeCeremony"),
    other: t("typeOther"),
  };
  return (type && labels[type]) || t("typeOther");
}

/** `1 h 30 min` / `45 min` — the wall-clock length of a schedule item. */
export function scheduleDurationLabel(
  item: Pick<ScheduleItem, "startsAt" | "endsAt">,
  t: Translate,
) {
  const minutes = durationMinutes(item.startsAt, item.endsAt);
  if (minutes < 60) return t("scheduleDurationMinutes", { minutes: String(minutes) });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? t("scheduleDurationHoursMinutes", { hours: String(hours), minutes: String(remainder) })
    : t("scheduleDurationHours", { hours: String(hours) });
}
