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

export type ScheduleStatus = "draft" | "scheduled" | "public" | "staffOnly";

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
 * A programme item's status is purely *who can see it*: shown, hidden, or
 * hidden-until-a-publish-date (H47, H48). Manage Schedule is a run-of-show —
 * a full rundown of every activity, past and future alike — so whether an
 * item happens to be running right now is not a status and is deliberately
 * not derived here; the times are already in the Starts/Ends columns.
 *
 * An item with no audience tag is staff-only, full stop — visibility/publishAt
 * only describe when a *tagged* audience gets to see an item, and the API
 * forces both back to hidden/null the moment an item has no audience (H59
 * follow-up, schedule_visibility_requires_audience), so a staff-only item
 * never goes through "draft"/"scheduled": it's always visible to staff.
 */
export function scheduleStatus(item: PublicScheduleItem, now = Date.now()): ScheduleStatus {
  if ((item.audiences ?? []).length === 0) return "staffOnly";
  if (item.visibility === "shown") return "public";
  // `visibility` is the answer, not a hint: a *past* publishAt on a hidden
  // item is spent (the publisher worker flips visibility itself when the date
  // comes due, and it leaves publish_at behind), so treating "due" as public
  // would make hiding an already-published item look like it did nothing.
  // Only a publish date still in the future means "scheduled to reveal".
  const publishAtMs = item.publishAt ? new Date(item.publishAt).getTime() : null;
  return publishAtMs !== null && publishAtMs > now ? "scheduled" : "draft";
}

export function scheduleStatusLabel(status: ScheduleStatus, t: Translate): string {
  const labels: Record<ScheduleStatus, string> = {
    draft: t("hiddenOption"),
    scheduled: t("dataStatusScheduled"),
    public: t("statusPublic"),
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

// --- Keyboard grid navigation (H59) ---------------------------------------

export type ScheduleNavigationDirection =
  | "next"
  | "previous"
  | "nextInRow"
  | "previousInRow"
  | "nextInColumn"
  | "previousInColumn";

/** Which way a keypress moves the focused cell, or null if it isn't navigation. */
export function scheduleNavigationDirection(event: {
  key: string;
  shiftKey?: boolean;
}): ScheduleNavigationDirection | null {
  if (event.key === "Tab") return event.shiftKey ? "previous" : "next";
  if (event.key === "ArrowLeft") return "previousInRow";
  if (event.key === "ArrowRight") return "nextInRow";
  if (event.key === "ArrowUp") return "previousInColumn";
  if (event.key === "ArrowDown") return "nextInColumn";
  return null;
}

/**
 * The same, minus the horizontal arrows, for a cell that is *open for
 * editing*: inside a text field Left/Right belong to the caret (and inside a
 * native date field, to its segments), so stealing them for column navigation
 * would make a typo unfixable without reaching for the mouse. Tab, Enter and
 * the vertical arrows still commit and move, the way a spreadsheet behaves.
 */
export function editingNavigationDirection(event: {
  key: string;
  shiftKey?: boolean;
}): ScheduleNavigationDirection | null {
  const direction = scheduleNavigationDirection(event);
  return direction === "nextInRow" || direction === "previousInRow" ? null : direction;
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

/** Stable local calendar key used to group schedule rows (H59). */
export function scheduleDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

/**
 * Reads whatever a hurried typist put in a time cell and returns canonical
 * "HH:mm", or null if it isn't a time at all (H59). A run-of-show is typed
 * fast, and demanding four digits and a colon for every cell is friction with
 * no payoff: "9:0", "9", "930" and "9.30" all say a time unambiguously.
 *
 *   "9"     -> "09:00"      "930"   -> "09:30"
 *   "9:0"   -> "09:00"      "0930"  -> "09:30"
 *   "9:5"   -> "09:05"      "9.30"  -> "09:30"
 *   "23:45" -> "23:45"      "9h30"  -> "09:30"
 *
 * Out-of-range values ("25:00", "9:75") are rejected rather than wrapped —
 * a wrapped time is a wrong time nobody asked for.
 */
export function parseTimeOfDay(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/[.,;hH]/g, ":")
    .replace(/:$/, "");
  const match =
    /^(\d{1,2})(?::(\d{1,2}))?$/.exec(cleaned) ??
    // Digits only, no separator: the last two are the minutes ("930", "0930").
    /^(\d{1,2})(\d{2})$/.exec(cleaned.replace(/:/g, ""));
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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

/** One calendar day, in ms — the roll applied when a window crosses midnight. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a window the inline time cells will roll into the next day. A
 * midnight crossing typed into a table with no date field is only ever a
 * night session (a talk that ends at 01:00, breakfast at 05:00); anything
 * longer is far more likely a typo — "09:00 to 07:00" is a slip, not a 22-hour
 * activity — and silently moving that item onto another date is the kind of
 * mistake nobody notices until the run-of-show is wrong. Past this, the edit
 * is refused and the item's real dates are set in the full editor (H59).
 */
export const MAX_INLINE_ROLLED_HOURS = 12;

export type ScheduleTimeEdit =
  | { ok: true; startsAt: string; endsAt: string; rolledToNextDay: boolean }
  | { ok: false; reason: "invalidTime" | "rolledWindowTooLong" };

/**
 * Applies a new HH:mm to one end of a schedule window, rolling the *other*
 * side into the next day when the edit would otherwise invert it (H59).
 *
 * Typing "00:00" as the end of a 23:00 item means "midnight tonight", not
 * "midnight this morning" — an inline time cell has no field for the date, so
 * a run-of-show that runs past midnight was impossible to enter without
 * opening the full editor. The same reading applies from the other side: move
 * a start past its end and the end is the one that crosses over. The roll is
 * capped at MAX_INLINE_ROLLED_HOURS so a mistyped time can't quietly push an
 * item onto another day.
 */
export function withTimeOfDayAcrossMidnight(
  startsAt: string,
  endsAt: string,
  field: "startsAt" | "endsAt",
  hhmm: string,
): ScheduleTimeEdit {
  const next = withTimeOfDay(field === "startsAt" ? startsAt : endsAt, hhmm);
  if (!next) return { ok: false, reason: "invalidTime" };

  const fixed = new Date(field === "startsAt" ? endsAt : startsAt).getTime();
  const edited = new Date(next).getTime();
  if (Number.isNaN(fixed) || Number.isNaN(edited)) return { ok: false, reason: "invalidTime" };

  const start = field === "startsAt" ? edited : fixed;
  const end = field === "startsAt" ? fixed : edited;
  if (end > start) {
    return {
      ok: true,
      startsAt: field === "startsAt" ? next : startsAt,
      endsAt: field === "startsAt" ? endsAt : next,
      rolledToNextDay: false,
    };
  }

  // Inverted: the end is the side that crosses midnight, whichever one moved.
  const rolledEnd = end + ONE_DAY_MS;
  if (rolledEnd - start > MAX_INLINE_ROLLED_HOURS * 60 * 60 * 1000) {
    return { ok: false, reason: "rolledWindowTooLong" };
  }
  return {
    ok: true,
    startsAt: field === "startsAt" ? next : startsAt,
    endsAt: new Date(rolledEnd).toISOString(),
    rolledToNextDay: true,
  };
}

/**
 * Re-applies a new calendar date (year/month/day) to an existing ISO
 * timestamp, keeping its time-of-day unchanged — the counterpart to
 * withTimeOfDay, used to drag a schedule item onto a different day without
 * disturbing when it starts/ends during that day.
 */
export function withDate(iso: string, targetDateIso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  // A YYYY-MM-DD value is a calendar date, not a UTC timestamp. Parsing it
  // with `new Date()` would turn midnight into the previous local day in
  // western time zones, so extract the parts explicitly (H59).
  const calendarMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDateIso);
  if (calendarMatch) {
    date.setFullYear(
      Number(calendarMatch[1]),
      Number(calendarMatch[2]) - 1,
      Number(calendarMatch[3]),
    );
    return date.toISOString();
  }

  const target = new Date(targetDateIso);
  if (Number.isNaN(target.getTime())) return null;
  date.setFullYear(target.getFullYear(), target.getMonth(), target.getDate());
  return date.toISOString();
}
