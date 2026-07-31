import { apiFetch } from "./api";
import type { useLocale } from "./i18n";

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
