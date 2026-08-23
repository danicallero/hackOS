import {
  activityKind,
  activityKindLabelKey,
  DEFAULT_ACTIVITY_KIND,
  toActivityKind,
} from "@hackos/shared/activity-kinds";
import type { Language } from "@hackos/shared/locale";
import type { SymbolViewProps } from "@/components/symbol";
import { apiFetch } from "./api";
import type { useLocale } from "./i18n";
import { durationMinutes } from "./presence-timeline";

type Translate = ReturnType<typeof useLocale>["t"];

/** `sponsor`/`participant`/`mentor` (H59) — empty on an item means staff-only, never stored literally. */
export type ScheduleAudience = "sponsor" | "participant" | "mentor";
export const SCHEDULE_AUDIENCES: ScheduleAudience[] = ["sponsor", "participant", "mentor"];

export interface ScheduleItem {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  startsAt: string;
  endsAt: string;
  audiences: ScheduleAudience[];
  publishAt?: string | null;
  contactNote?: string | null;
  notes?: string | null;
  owners?: ScheduleOwner[];
  /** Staff-only — present when the caller is staff, telling a draft apart from a live item. */
  visibility?: "shown" | "hidden";
  /** Language `title`/`description` are authored in — every viewer resolves their own display text: preferred language, else English, else this. */
  primaryLanguage: Language;
  titleI18n: Partial<Record<Language, string>>;
  descriptionI18n: Partial<Record<Language, string | null>>;
}

/** Complete management record, present on `GET /api/schedule`. */
export interface AdminScheduleItem extends ScheduleItem {
  requiresScan: boolean;
  visibility: "shown" | "hidden";
  publishAt: string | null;
  contactNote: string | null;
  notes: string | null;
  owners: ScheduleOwner[];
}

/**
 * Either a real hackOS account (userId set, name/surname/email from `users`)
 * or a free-text name with no login (freeTextName set) — never both.
 */
export interface ScheduleOwner {
  id: number;
  userId: number | null;
  name: string | null;
  surname: string | null;
  email?: string;
  freeTextName: string | null;
}

export interface ScheduleInput {
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  requiresScan: boolean;
  startsAt: string;
  endsAt: string;
  visibility: "shown" | "hidden";
  publishAt: string | null;
  audiences: ScheduleAudience[];
  contactNote: string | null;
  notes: string | null;
}

export type ScheduleTranslation = { title?: string; description?: string | null };
export type ScheduleTranslations = Partial<Record<Language, ScheduleTranslation>>;

/** Replace one item in the in-memory/offline schedule snapshot after a save. */
export function upsertScheduleItem(
  current: ScheduleItem[] | null,
  updated: ScheduleItem,
): ScheduleItem[] {
  if (!current) return [updated];
  const index = current.findIndex((item) => item.id === updated.id);
  if (index === -1) return [...current, updated];
  return current.map((item, itemIndex) => (itemIndex === index ? updated : item));
}

/**
 * Resolves what a viewer sees for a schedule item's title/description (H50
 * extension): their preferred language if translated, else English, else the
 * item's primary (authored) language — never blank, since primaryLanguage's
 * canonical `title`/`description` is always filled.
 */
export function resolveScheduleText(
  item: ScheduleItem,
  language: Language,
): { title: string; description: string | null } {
  const firstText = (...values: (string | null | undefined)[]) =>
    values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
  const fallbackLanguage =
    language === item.primaryLanguage || language === "en" ? undefined : "en";
  return {
    // Resolve title and description independently. A translated title must
    // not hide an available description (or vice versa) when translations
    // were entered one field at a time (H50).
    title:
      firstText(
        language === item.primaryLanguage ? undefined : item.titleI18n?.[language],
        fallbackLanguage ? item.titleI18n?.[fallbackLanguage] : undefined,
        item.title,
      ) ?? item.title,
    description: firstText(
      language === item.primaryLanguage ? undefined : item.descriptionI18n?.[language],
      fallbackLanguage ? item.descriptionI18n?.[fallbackLanguage] : undefined,
      item.description,
    ),
  };
}

/** H50 extension: whether automatic translation is configured for this deployment. */
export async function fetchScheduleTranslateAvailability(): Promise<boolean> {
  const response = await apiFetch<{ available: boolean }>("/api/schedule/translate-availability");
  return response.available;
}

/**
 * Machine-translates arbitrary title+description content into
 * targetLanguages, auto-detecting the source language — content-scoped (no
 * id), so both the create and edit forms can call it before the item is
 * saved. Doesn't persist; save the result via saveScheduleTranslations.
 */
export async function translateScheduleContent(body: {
  title: string;
  description?: string | null;
  targetLanguages: Language[];
}): Promise<ScheduleTranslations> {
  return apiFetch<ScheduleTranslations>("/api/schedule/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Manually saves/redoes one or more locales' title/description without touching the others. */
export async function saveScheduleTranslations(
  id: number,
  translations: ScheduleTranslations,
): Promise<AdminScheduleItem> {
  return apiFetch<AdminScheduleItem>(`/api/schedule/${id}/translations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ translations }),
  });
}

export async function fetchPublicSchedule(): Promise<ScheduleItem[]> {
  const response = await apiFetch<{ items: ScheduleItem[] }>("/api/public/activities");
  return response.items;
}

/** Full run-of-show, `SCHEDULE_MANAGE` only — includes drafts and staff-only fields. */
export async function fetchAdminSchedule(): Promise<AdminScheduleItem[]> {
  const response = await apiFetch<{ items: AdminScheduleItem[] }>("/api/schedule");
  return response.items;
}

export async function createScheduleItem(body: ScheduleInput): Promise<AdminScheduleItem> {
  return apiFetch<AdminScheduleItem>("/api/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateScheduleItem(
  id: number,
  body: Partial<ScheduleInput>,
): Promise<AdminScheduleItem> {
  return apiFetch<AdminScheduleItem>(`/api/schedule/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteScheduleItem(id: number): Promise<void> {
  await apiFetch<{ deleted: true }>(`/api/schedule/${id}`, { method: "DELETE" });
}

export async function fetchScheduleOwnerCandidates(
  q: string,
  limit = 8,
): Promise<{ id: number; email: string; name: string | null; surname: string | null }[]> {
  const response = await apiFetch<{
    users: { id: number; email: string; name: string | null; surname: string | null }[];
  }>(`/api/schedule/owner-candidates?q=${encodeURIComponent(q)}&limit=${limit}`);
  return response.users;
}

export async function addScheduleOwner(
  scheduleId: number,
  input: { userId: number } | { freeTextName: string },
): Promise<ScheduleOwner> {
  return apiFetch<ScheduleOwner>(`/api/schedule/${scheduleId}/owners`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function removeScheduleOwner(scheduleId: number, ownerId: number): Promise<void> {
  await apiFetch(`/api/schedule/${scheduleId}/owners/${ownerId}`, { method: "DELETE" });
}

export function scheduleTypeLabel(type: string | null | undefined, t: Translate): string {
  return t(activityKindLabelKey(toActivityKind(type) ?? DEFAULT_ACTIVITY_KIND));
}

/**
 * SF Symbol for a schedule item's category (Android aliases live in
 * components/symbol.tsx, where the registry's symbols are mandatory at
 * compile time). Categories this build doesn't know — older rows, retired
 * kinds — get `fallback`. The cast is unavoidable: expo-symbols' name union
 * isn't referenceable from the shared package.
 */
export function activityKindSymbol(
  category: string | null | undefined,
  fallback: SymbolViewProps["name"] = "sparkles",
): SymbolViewProps["name"] {
  const kind = toActivityKind(category);
  return kind ? (activityKind(kind).symbol as SymbolViewProps["name"]) : fallback;
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

/** Collapses runs of 2+ blank lines down to one, so author-added gaps don't render as dead space. */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}
