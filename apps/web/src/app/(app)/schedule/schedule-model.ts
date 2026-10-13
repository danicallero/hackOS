import {
  type ActivityKind,
  activityKindLabelKey,
  DEFAULT_ACTIVITY_KIND,
  toActivityKind,
} from "@hackos/shared/activity-kinds";
import { instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
import { getEventTimeZone } from "@/lib/event-time";
import { LOCALE_CODES, type Translate } from "@/lib/i18n";
import type { PublicScheduleItem, ScheduleInput, ScheduleTranslations } from "@/lib/logistics";
import type { Tone } from "@/lib/tones";
import type { Language } from "@/lib/types";

export type ScheduleStatus = "draft" | "scheduled" | "public" | "staffOnly";

export const SCHEDULE_STATUS_TONES: Record<ScheduleStatus, Tone> = {
  draft: "neutral",
  scheduled: "warning",
  public: "info",
  staffOnly: "neutral",
};

export function scheduleTypeLabel(type: string | null | undefined, t: Translate): string {
  return t(activityKindLabelKey(toActivityKind(type) ?? DEFAULT_ACTIVITY_KIND));
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

// Every calendar day and clock reading below is the EVENT's (H45/H47), so a
// roster opened from another time zone shows the same run-of-show.

/** Short "Fri 22/08" style day label for a run-of-show table (H59). */
export function scheduleDayLabel(
  iso: string,
  language: keyof typeof LOCALE_CODES,
  timeZone: string = getEventTimeZone(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE_CODES[language], {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(date);
}

/** Stable event-zone calendar key used to group schedule rows (H59). */
export function scheduleDayKey(iso: string, timeZone: string = getEventTimeZone()): string {
  return instantToWallClock(iso, timeZone).slice(0, 10);
}

/** "08:00" time-of-day for a run-of-show table's separate Start/End columns (H59). */
export function scheduleTimeOfDay(
  iso: string,
  language: keyof typeof LOCALE_CODES,
  timeZone: string = getEventTimeZone(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE_CODES[language], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
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

/** HH:mm (event time) for populating a `<input type="time">` from an ISO timestamp. */
export function timeInputValue(iso: string, timeZone: string = getEventTimeZone()): string {
  return instantToWallClock(iso, timeZone).slice(11, 16);
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
export function withTimeOfDay(
  iso: string,
  hhmm: string,
  timeZone: string = getEventTimeZone(),
): string | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const wall = instantToWallClock(iso, timeZone);
  if (!wall) return null;
  return wallClockToInstant(`${wall.slice(0, 10)}T${hhmm}`, timeZone);
}

/** The same event-zone clock reading `days` calendar days later (a DST day is not 24 h). */
function addWallDays(ms: number, days: number, timeZone: string = getEventTimeZone()): number {
  const wall = instantToWallClock(new Date(ms).toISOString(), timeZone, true);
  const [y, m, d] = wall.slice(0, 10).split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  const iso = wallClockToInstant(`${moved}T${wall.slice(11)}`, timeZone);
  return iso ? new Date(iso).getTime() : ms + days * 86_400_000;
}

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
  const rolledEnd = addWallDays(end, 1);
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
export function withDate(
  iso: string,
  targetDateIso: string,
  timeZone: string = getEventTimeZone(),
): string | null {
  const wall = instantToWallClock(iso, timeZone);
  if (!wall) return null;

  // A YYYY-MM-DD value is a calendar date, not a UTC timestamp: use it as is
  // rather than reading it as an instant (H59).
  const calendarMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(targetDateIso);
  const targetDate = calendarMatch
    ? calendarMatch[1]
    : instantToWallClock(targetDateIso, timeZone).slice(0, 10);
  if (!targetDate) return null;
  return wallClockToInstant(`${targetDate}T${wall.slice(11)}`, timeZone);
}

// --- Inline row creation (H59) --------------------------------------------

/** Length a freshly inserted row gets when nothing constrains it. */
export const DRAFT_DEFAULT_MINUTES = 30;
/** Where a row lands on a day that has no items yet. */
export const DRAFT_DEFAULT_START_HOUR = 9;

const MINUTE_MS = 60_000;

/** Event-zone midnight of a `YYYY-MM-DD` day key, as a timestamp. */
function dayStartMs(dayKey: string, timeZone: string = getEventTimeZone()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const iso = wallClockToInstant(`${dayKey}T00:00`, timeZone);
  return iso ? new Date(iso).getTime() : null;
}

/**
 * The start/end a row inserted at a given point in the table should get,
 * derived from the rows it lands between (H59 inline row creation).
 *
 * The whole point of inserting *there* rather than opening the form is that
 * the position already says when the activity happens: it starts when the
 * row above ends, and it stops at the row below if the gap is shorter than
 * the default. Gaps of zero (or rows that already overlap) still produce a
 * default-length row — the table shows overlaps rather than forbidding them,
 * and a zero-length activity would be rejected by the API.
 */
export function draftWindowBetween(
  previousEndsAt: string | null,
  nextStartsAt: string | null,
  dayKey: string,
): { startsAt: string; endsAt: string } | null {
  const dayStart = dayStartMs(dayKey);
  if (dayStart === null) return null;
  const defaultMs = DRAFT_DEFAULT_MINUTES * MINUTE_MS;

  const previous = previousEndsAt ? new Date(previousEndsAt).getTime() : Number.NaN;
  const next = nextStartsAt ? new Date(nextStartsAt).getTime() : Number.NaN;

  if (!Number.isNaN(previous)) {
    const start = previous;
    const untilNext = Number.isNaN(next) ? Number.POSITIVE_INFINITY : next - start;
    const length = untilNext > 0 ? Math.min(defaultMs, untilNext) : defaultMs;
    return {
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + length).toISOString(),
    };
  }

  if (!Number.isNaN(next)) {
    // Inserting above the day's first row: back off from it, but never into
    // the previous day — that would drop the row into another group.
    const start = Math.max(next - defaultMs, dayStart);
    if (start >= next) {
      return {
        startsAt: new Date(next).toISOString(),
        endsAt: new Date(next + defaultMs).toISOString(),
      };
    }
    return { startsAt: new Date(start).toISOString(), endsAt: new Date(next).toISOString() };
  }

  const defaultStart = wallClockToInstant(
    `${dayKey}T${String(DRAFT_DEFAULT_START_HOUR).padStart(2, "0")}:00`,
    getEventTimeZone(),
  );
  const start = defaultStart ? new Date(defaultStart).getTime() : dayStart;
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + defaultMs).toISOString(),
  };
}

// --- Grouping and ordering (H59) -------------------------------------------

export function ownerDisplayName(owner: {
  name: string | null;
  surname: string | null;
  email?: string;
  freeTextName: string | null;
}): string {
  return (
    owner.freeTextName ??
    ([owner.name, owner.surname].filter(Boolean).join(" ") || owner.email || "")
  );
}

export function ownerNames(item: PublicScheduleItem): string {
  return (item.owners ?? []).map(ownerDisplayName).join(", ");
}

export interface DayGroup {
  label: string;
  /** Local YYYY-MM-DD key; unlike the label it stays unique across locales. */
  date: string;
  items: PublicScheduleItem[];
}

/** A row typed into the table but not created yet (H59 inline row creation). */
export interface ScheduleDraft {
  /** Local YYYY-MM-DD key of the day section it belongs to. */
  dayKey: string;
  /** Slot between that day's rows: 0 is above the first, `items.length` below the last. */
  index: number;
  startsAt: string;
  endsAt: string;
}

export function groupByDay(
  items: PublicScheduleItem[],
  language: Parameters<typeof scheduleDayLabel>[1],
) {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const date = scheduleDayKey(item.startsAt);
    const label = scheduleDayLabel(item.startsAt, language);
    const last = groups.at(-1);
    if (last?.date === date) last.items.push(item);
    else groups.push({ label, date, items: [item] });
  }
  return groups;
}

export function compareScheduleItems(a: PublicScheduleItem, b: PublicScheduleItem): number {
  const startDelta = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  return startDelta || a.id - b.id;
}

/**
 * The Manage Schedule table's combined search/audience/kind filter,
 * chronologically sorted (H59). Extracted from the page component so the
 * filtering rule is independently testable rather than only exercisable
 * through the full table render.
 */
export function filterScheduleItems(
  items: PublicScheduleItem[],
  {
    query,
    audienceFilter,
    staffOnlyFilter,
    kindFilter,
  }: {
    query: string;
    audienceFilter: ReadonlySet<ScheduleAudience>;
    staffOnlyFilter: boolean;
    kindFilter: ReadonlySet<ActivityKind>;
  },
): PublicScheduleItem[] {
  const q = query.trim().toLowerCase();
  let list = q
    ? items.filter((item) =>
        `${item.title} ${item.location ?? ""} ${ownerNames(item)}`.toLowerCase().includes(q),
      )
    : items;
  if (audienceFilter.size > 0 || staffOnlyFilter) {
    list = list.filter((item) => {
      const audiences = item.audiences ?? [];
      if (audiences.length === 0) return staffOnlyFilter;
      return audiences.some((a) => audienceFilter.has(a));
    });
  }
  if (kindFilter.size > 0) {
    list = list.filter((item) =>
      kindFilter.has(toActivityKind(item.type) ?? DEFAULT_ACTIVITY_KIND),
    );
  }
  // groupByDay merges same-day items only when they're adjacent in this
  // list — sort chronologically first so every day forms exactly one
  // contiguous (and correctly ordered) group.
  return [...list].sort(compareScheduleItems);
}

const SUBMISSION_LANGUAGES: Language[] = ["es", "gl", "en"];

/**
 * Title and description only need to exist in ONE language (H48, H50
 * extension): every viewer falls back to English, then the authored language.
 * When the editor left their own language blank, the first filled translation
 * becomes the canonical text and `titleLanguage` tells the API which language
 * that is. Returns null when no language has a title.
 */
export function prepareScheduleSubmission(
  values: ScheduleInput,
  translations: ScheduleTranslations,
): { values: ScheduleInput; translations: ScheduleTranslations } | null {
  const cleaned: ScheduleTranslations = {};
  for (const language of SUBMISSION_LANGUAGES) {
    const title = translations[language]?.title?.trim();
    const description = translations[language]?.description?.trim();
    // The API rejects empty strings; a blank field simply isn't sent.
    if (title || description) {
      cleaned[language] = {
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      };
    }
  }

  if (values.title.trim()) return { values, translations: cleaned };

  const source = SUBMISSION_LANGUAGES.find((language) => cleaned[language]?.title);
  if (!source) return null;
  const { [source]: promoted, ...rest } = cleaned;
  return {
    values: {
      ...values,
      title: promoted?.title ?? "",
      description: promoted?.description ?? null,
      titleLanguage: source,
    },
    translations: rest,
  };
}
