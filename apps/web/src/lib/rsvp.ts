import { formatEventDate } from "./datetime";
import type { Language } from "./types";

/** Catering/activity RSVPs (API: /api/me/rsvps, /api/schedule/:id/rsvp, /api/logistics/rsvps). */

export type RsvpAnswer = "yes" | "no" | "unsure";
export type RsvpKind = "participant" | "mentor" | "sponsor" | "staff";
export const RSVP_KINDS: readonly RsvpKind[] = ["participant", "mentor", "sponsor", "staff"];

export interface RsvpItem {
  activityId: number;
  name: string;
  description: string | null;
  date: string;
  closesAt: string;
  location: string | null;
  required: boolean;
  options: { key: string; label: string }[];
  answer: RsvpAnswer | null;
  optionKey: string | null;
  optionLabel: string | null;
  allowsUnsure: boolean;
  optionRetired: boolean;
  locked: boolean;
  isMeal: boolean;
}

/** One draft answer per item; `optionKey` only matters for "yes". */
export type RsvpDraft = Record<number, { answer: RsvpAnswer | null; optionKey: string | null }>;

export function draftFromItems(items: readonly RsvpItem[]): RsvpDraft {
  return Object.fromEntries(
    items.map((item) => [item.activityId, { answer: item.answer, optionKey: item.optionKey }]),
  );
}

/** An open item still needs the person: no answer yet, or "unsure" on a required item. */
export function needsAnswer(item: RsvpItem, answer: RsvpAnswer | null): boolean {
  if (item.locked) return false;
  return answer === null ? item.required : item.required && answer === "unsure";
}

/** "yes" on an item with options also needs one chosen; a retired stored option must be re-picked. */
export function needsOption(item: RsvpItem, draft: RsvpDraft[number]): boolean {
  if (draft.answer !== "yes" || item.options.length === 0) return false;
  return !draft.optionKey || !item.options.some((o) => o.key === draft.optionKey);
}

export function isItemChanged(item: RsvpItem, draft: RsvpDraft[number]): boolean {
  return (
    draft.answer !== item.answer || (draft.answer === "yes" && draft.optionKey !== item.optionKey)
  );
}

/** True while the draft cannot be submitted: a required item unanswered or a chosen yes without option. */
export function draftBlocked(items: readonly RsvpItem[], draft: RsvpDraft): boolean {
  return items.some((item) => {
    if (item.locked) return false;
    const d = draft[item.activityId];
    return needsAnswer(item, d.answer) || needsOption(item, d);
  });
}

/**
 * PUT body. Only open, changed items are sent (locked ones never change and an
 * unchanged echo is pointless), so a stale list can't overwrite newer answers.
 * Unanswered optional items are skipped: skipping is a valid state.
 */
export function rsvpBody(items: readonly RsvpItem[], draft: RsvpDraft) {
  return {
    answers: items.flatMap((item) => {
      const d = draft[item.activityId];
      if (item.locked || d.answer === null || !isItemChanged(item, d)) return [];
      return [
        {
          activityId: item.activityId,
          answer: d.answer,
          ...(d.answer === "yes" && item.options.length > 0 ? { optionKey: d.optionKey } : {}),
        },
      ];
    }),
  };
}

export function rsvpWhen(item: RsvpItem, lang: Language): string {
  return `${formatEventDate(item.date, lang, "weekdayDayMonthText")}, ${formatEventDate(item.date, lang, "clock")}`;
}

/** API error reasons after which the stored list differs from what the caller submitted. */
export const STALE_RSVP_REASONS = new Set([
  "rsvp_locked",
  "rsvp_incomplete",
  "rsvp_not_offered",
  "rsvp_option_required",
  "rsvp_option_invalid",
  "rsvp_participants_excluded",
]);

// ── Organizer settings ────────────────────────────────────────────────────

export interface RsvpKindCounts {
  attending: number;
  notAttending: number;
  unsure: number;
  unanswered: number;
}

export interface RsvpSummary extends RsvpKindCounts {
  activityId: number;
  name: string;
  nameI18n: Record<string, string>;
  startsAt: string;
  isMeal: boolean;
  required: boolean;
  eligible: number;
  byKind: Partial<Record<RsvpKind, RsvpKindCounts>>;
  byOption: {
    key: string;
    labelI18n: Record<string, string> | null;
    retired: boolean;
    n: number;
  }[];
  intolerances: { id: number; label: Record<string, string>; n: number }[];
  withNotes: number;
}

export interface RsvpSettingsOption {
  key: string;
  labelI18n: Record<string, string>;
  retired: boolean;
}

export interface RsvpSettings {
  activityId: number;
  scheduleId: number;
  isMeal: boolean;
  enabled: boolean;
  required: boolean;
  kinds: RsvpKind[];
  nameI18n: Record<string, string> | null;
  descriptionI18n: Record<string, string> | null;
  rsvpDate: string | null;
  closesAt: string | null;
  options: RsvpSettingsOption[];
  defaults: { name: string; description: string | null; date: string; closesAt: string };
  counts: RsvpSummary | null;
}

/** The editable part of the settings, as PUT /api/schedule/:id/rsvp takes it. */
export interface RsvpSettingsDraft {
  enabled: boolean;
  required: boolean;
  kinds: RsvpKind[];
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  rsvpDate: string;
  closesAt: string;
  options: { key: string; labelI18n: Record<string, string> }[];
}

export const OPTION_KEY_PATTERN = /^[a-z0-9_]{1,30}$/;
export const MAX_RSVP_OPTIONS = 10;

/** Kinds an activity may ask: meals never include participants. */
export function askableKinds(isMeal: boolean): RsvpKind[] {
  return RSVP_KINDS.filter((kind) => !(isMeal && kind === "participant"));
}

export function slugifyOptionKey(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 26) || "option";
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

export function settingsToDraft(
  settings: RsvpSettings,
  toLocal: (iso: string | null) => string,
): RsvpSettingsDraft {
  return {
    enabled: settings.enabled,
    required: settings.required,
    kinds: [...settings.kinds],
    nameI18n: { ...(settings.nameI18n ?? {}) },
    descriptionI18n: { ...(settings.descriptionI18n ?? {}) },
    rsvpDate: toLocal(settings.rsvpDate),
    closesAt: toLocal(settings.closesAt),
    options: settings.options
      .filter((o) => !o.retired)
      .map((o) => ({ key: o.key, labelI18n: { ...o.labelI18n } })),
  };
}

const nonBlank = (map: Record<string, string>) =>
  Object.keys(map).length === 0 || Object.values(map).every((v) => v.trim() === "")
    ? null
    : Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim() !== ""));

export function draftToBody(
  draft: RsvpSettingsDraft,
  toIso: (local: string) => string | null,
  isMeal: boolean,
) {
  return {
    enabled: draft.enabled,
    required: draft.enabled && draft.required,
    kinds: draft.kinds.filter((k) => askableKinds(isMeal).includes(k)),
    nameI18n: nonBlank(draft.nameI18n),
    descriptionI18n: nonBlank(draft.descriptionI18n),
    rsvpDate: toIso(draft.rsvpDate),
    closesAt: toIso(draft.closesAt),
    options: draft.options.map((o) => ({ key: o.key, labelI18n: nonBlank(o.labelI18n) ?? {} })),
  };
}

/** Why the draft can't be saved, as a message key, or null. */
export function settingsDraftError(
  draft: RsvpSettingsDraft,
): "rsvpKindsRequired" | "rsvpOptionLabelRequired" | null {
  if (draft.enabled && draft.kinds.length === 0) return "rsvpKindsRequired";
  if (draft.options.some((o) => nonBlank(o.labelI18n) === null)) return "rsvpOptionLabelRequired";
  return null;
}
