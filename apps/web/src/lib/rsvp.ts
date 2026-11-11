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
  answer: RsvpAnswer | null;
  locked: boolean;
  isMeal: boolean;
}

/** One draft answer per item. */
export type RsvpDraft = Record<number, { answer: RsvpAnswer | null }>;

export function draftFromItems(items: readonly RsvpItem[]): RsvpDraft {
  return Object.fromEntries(items.map((item) => [item.activityId, { answer: item.answer }]));
}

export function isItemChanged(item: RsvpItem, draft: RsvpDraft[number]): boolean {
  return draft.answer !== item.answer;
}

/**
 * PUT body. Only open, changed items are sent (locked ones never change and an
 * unchanged echo is pointless), so a stale list can't overwrite newer answers.
 * Unanswered items are skipped: skipping is always valid.
 */
export function rsvpBody(items: readonly RsvpItem[], draft: RsvpDraft) {
  return {
    answers: items.flatMap((item) => {
      const d = draft[item.activityId];
      if (item.locked || d.answer === null || !isItemChanged(item, d)) return [];
      return [{ activityId: item.activityId, answer: d.answer }];
    }),
  };
}

export function rsvpWhen(item: RsvpItem, lang: Language): string {
  return `${formatEventDate(item.date, lang, "weekdayDayMonthText")}, ${formatEventDate(item.date, lang, "clock")}`;
}

/** API error reasons after which the stored list differs from what the caller submitted. */
export const STALE_RSVP_REASONS = new Set([
  "rsvp_locked",
  "rsvp_not_offered",
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
  scheduleId: number;
  name: string;
  nameI18n: Record<string, string>;
  startsAt: string;
  isMeal: boolean;
  eligible: number;
  byKind: Partial<Record<RsvpKind, RsvpKindCounts>>;
  intolerances: { id: number; label: Record<string, string>; n: number }[];
  withNotes: number;
}

export interface RsvpSettings {
  activityId: number;
  scheduleId: number;
  isMeal: boolean;
  enabled: boolean;
  kinds: RsvpKind[];
  /** The roles asked: holding any of them is enough. */
  roleIds: number[];
  nameI18n: Record<string, string> | null;
  descriptionI18n: Record<string, string> | null;
  rsvpDate: string | null;
  closesAt: string | null;
  defaults: { name: string; description: string | null; date: string; closesAt: string };
  counts: RsvpSummary | null;
}

/** The editable part of the settings, as PUT /api/schedule/:id/rsvp takes it. */
export interface RsvpSettingsDraft {
  enabled: boolean;
  kinds: RsvpKind[];
  roleIds: number[];
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  rsvpDate: string;
  closesAt: string;
}

/** Kinds an activity may ask: meals never include participants. */
export function askableKinds(isMeal: boolean): RsvpKind[] {
  return RSVP_KINDS.filter((kind) => !(isMeal && kind === "participant"));
}

export function settingsToDraft(
  settings: RsvpSettings,
  toLocal: (iso: string | null) => string,
): RsvpSettingsDraft {
  return {
    enabled: settings.enabled,
    kinds: [...settings.kinds],
    roleIds: [...(settings.roleIds ?? [])],
    nameI18n: { ...(settings.nameI18n ?? {}) },
    descriptionI18n: { ...(settings.descriptionI18n ?? {}) },
    rsvpDate: toLocal(settings.rsvpDate),
    closesAt: toLocal(settings.closesAt),
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
    kinds: draft.kinds.filter((k) => askableKinds(isMeal).includes(k)),
    roleIds: draft.roleIds,
    nameI18n: nonBlank(draft.nameI18n),
    descriptionI18n: nonBlank(draft.descriptionI18n),
    rsvpDate: toIso(draft.rsvpDate),
    closesAt: toIso(draft.closesAt),
  };
}

/** Why the draft can't be saved, as a message key, or null. */
export function settingsDraftError(draft: RsvpSettingsDraft): "rsvpKindsRequired" | null {
  if (draft.enabled && draft.kinds.length === 0 && draft.roleIds.length === 0)
    return "rsvpKindsRequired";
  return null;
}

/** GET /api/logistics/rsvps/:activityId/people: everyone asked, with their answer. */
export interface RsvpPerson {
  userId: number;
  name: string | null;
  surname: string | null;
  kind: RsvpKind;
  enterprise: string | null;
  state: RsvpAnswer | "unanswered";
}
