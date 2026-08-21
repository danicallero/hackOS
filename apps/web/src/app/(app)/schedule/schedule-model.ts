import {
  CalendarDaysIcon,
  FlagIcon,
  MicIcon,
  PartyPopperIcon,
  SparklesIcon,
  UtensilsIcon,
} from "lucide-react";
import { LOCALE_CODES, type Translate } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import type { Tone } from "@/lib/tones";

export type ScheduleStatus = "draft" | "scheduled" | "public" | "active" | "ended" | "staffOnly";

const TYPE_ICONS: Record<string, typeof CalendarDaysIcon> = {
  activity: SparklesIcon,
  meal: UtensilsIcon,
  workshop: MicIcon,
  talk: MicIcon,
  ceremony: PartyPopperIcon,
  deadline: FlagIcon,
  other: CalendarDaysIcon,
};

export const SCHEDULE_STATUS_TONES: Record<ScheduleStatus, Tone> = {
  draft: "neutral",
  scheduled: "warning",
  public: "info",
  active: "success",
  ended: "neutral",
  staffOnly: "neutral",
};

export function scheduleTypeLabel(type: string | null | undefined, t: Translate): string {
  const labels: Record<string, string> = {
    activity: t("typeActivity"),
    meal: t("typeMeal"),
    workshop: t("typeWorkshop"),
    talk: t("typeTalk"),
    ceremony: t("typeCeremony"),
    deadline: t("typeDeadline"),
    other: t("typeOther"),
  };
  return (type && labels[type]) || t("typeActivity");
}

export function scheduleTypeIcon(type: string | null | undefined) {
  return (type && TYPE_ICONS[type]) || CalendarDaysIcon;
}

/**
 * Programme items expose one of six states so staff and public readers can
 * tell what is public now, upcoming, or over without inspecting raw
 * visibility/publishAt fields (H47, H48). An item with no audience tag is
 * staff-only, full stop — visibility/publishAt only describe when a *tagged*
 * audience gets to see an item, and the API forces both back to
 * hidden/null the moment an item has no audience (H59 follow-up,
 * schedule_visibility_requires_audience), so a staff-only item never goes
 * through "draft"/"scheduled": it's always visible to staff, and "active"
 * still tracks whether it's happening right now for their own run-of-show.
 */
export function scheduleStatus(item: PublicScheduleItem, now = Date.now()): ScheduleStatus {
  const isStaffOnly = (item.audiences ?? []).length === 0;
  const publishAtMs = item.publishAt ? new Date(item.publishAt).getTime() : null;
  const isVisible =
    isStaffOnly || item.visibility === "shown" || (publishAtMs !== null && publishAtMs <= now);
  if (!isVisible) return publishAtMs !== null ? "scheduled" : "draft";
  const startsMs = new Date(item.startsAt).getTime();
  const endsMs = new Date(item.endsAt).getTime();
  if (!Number.isNaN(endsMs) && endsMs <= now) return "ended";
  if (!Number.isNaN(startsMs) && startsMs <= now) return "active";
  return isStaffOnly ? "staffOnly" : "public";
}

export function scheduleStatusLabel(status: ScheduleStatus, t: Translate): string {
  const labels: Record<ScheduleStatus, string> = {
    draft: t("dataStatusDraft"),
    scheduled: t("dataStatusScheduled"),
    public: t("statusPublic"),
    active: t("statusLive"),
    ended: t("statusEnded"),
    staffOnly: t("statusStaffOnly"),
  };
  return labels[status];
}

/**
 * H59: who a live item is shown to, independent of visibility/publishAt.
 * Staff always sees everything implicitly and is never a stored value or a
 * selectable checkbox; leaving all three unchecked means "staff-only".
 * Anonymous/public web+TV feeds are served the same slice as "participant" —
 * there is no separate "public" audience.
 */
export const SCHEDULE_AUDIENCES = ["sponsor", "participant", "mentor"] as const;
export type ScheduleAudience = (typeof SCHEDULE_AUDIENCES)[number];

export function scheduleAudienceLabel(audience: ScheduleAudience, t: Translate): string {
  const labels: Record<ScheduleAudience, string> = {
    sponsor: t("audienceSponsor"),
    participant: t("audienceParticipant"),
    mentor: t("audienceMentor"),
  };
  return labels[audience];
}

/** Short "Fri 22/08" style day label for a run-of-show table (H59). */
export function scheduleDayLabel(iso: string, language: keyof typeof LOCALE_CODES): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE_CODES[language], {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

/** "08:00" time-of-day for a run-of-show table's separate Start/End columns (H59). */
export function scheduleTimeOfDay(iso: string, language: keyof typeof LOCALE_CODES): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE_CODES[language], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** "1:30" h:mm duration between two ISO timestamps, auto-computed (H59). */
export function scheduleDuration(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return "";
  const totalMinutes = Math.round((end - start) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/** HH:mm (local time) for populating a `<input type="time">` from an ISO timestamp. */
export function timeInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Re-applies a new HH:mm to an existing ISO timestamp's date, keeping the date unchanged. */
export function withTimeOfDay(iso: string, hhmm: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date.toISOString();
}

/**
 * Re-applies a new calendar date (year/month/day) to an existing ISO
 * timestamp, keeping its time-of-day unchanged — the counterpart to
 * withTimeOfDay, used to drag a schedule item onto a different day without
 * disturbing when it starts/ends during that day.
 */
export function withDate(iso: string, targetDateIso: string): string | null {
  const date = new Date(iso);
  const target = new Date(targetDateIso);
  if (Number.isNaN(date.getTime()) || Number.isNaN(target.getTime())) return null;
  date.setFullYear(target.getFullYear(), target.getMonth(), target.getDate());
  return date.toISOString();
}
