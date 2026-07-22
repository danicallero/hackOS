import {
  CalendarDaysIcon,
  MicIcon,
  PartyPopperIcon,
  SparklesIcon,
  UtensilsIcon,
} from "lucide-react";
import type { Translate } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import type { Tone } from "@/lib/tones";

export type ScheduleStatus = "draft" | "scheduled" | "public" | "active" | "ended";

const TYPE_ICONS: Record<string, typeof CalendarDaysIcon> = {
  activity: SparklesIcon,
  meal: UtensilsIcon,
  workshop: MicIcon,
  talk: MicIcon,
  ceremony: PartyPopperIcon,
  other: CalendarDaysIcon,
};

export const SCHEDULE_STATUS_TONES: Record<ScheduleStatus, Tone> = {
  draft: "neutral",
  scheduled: "warning",
  public: "info",
  active: "success",
  ended: "neutral",
};

export function scheduleTypeLabel(type: string | null | undefined, t: Translate): string {
  const labels: Record<string, string> = {
    activity: t("typeActivity"),
    meal: t("typeMeal"),
    workshop: t("typeWorkshop"),
    talk: t("typeTalk"),
    ceremony: t("typeCeremony"),
    other: t("typeOther"),
  };
  return (type && labels[type]) || t("typeActivity");
}

export function scheduleTypeIcon(type: string | null | undefined) {
  return (type && TYPE_ICONS[type]) || CalendarDaysIcon;
}

/**
 * Programme items expose one of five states so staff and public readers can
 * tell what is public now, upcoming, or over without inspecting raw
 * visibility/publishAt fields (H47, H48).
 */
export function scheduleStatus(item: PublicScheduleItem, now = Date.now()): ScheduleStatus {
  const publishAtMs = item.publishAt ? new Date(item.publishAt).getTime() : null;
  const isVisible = item.visibility === "shown" || (publishAtMs !== null && publishAtMs <= now);
  if (!isVisible) return publishAtMs !== null ? "scheduled" : "draft";
  const startsMs = new Date(item.startsAt).getTime();
  const endsMs = new Date(item.endsAt).getTime();
  if (!Number.isNaN(endsMs) && endsMs <= now) return "ended";
  if (!Number.isNaN(startsMs) && startsMs <= now) return "active";
  return "public";
}

export function scheduleStatusLabel(status: ScheduleStatus, t: Translate): string {
  const labels: Record<ScheduleStatus, string> = {
    draft: t("dataStatusDraft"),
    scheduled: t("dataStatusScheduled"),
    public: t("statusPublic"),
    active: t("statusLive"),
    ended: t("statusEnded"),
  };
  return labels[status];
}
