import { ACTIVITY_KINDS, type ActivityKind } from "@hackos/shared/activity-kinds";
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
}

/** Admin-only fields, present on `GET /api/schedule` but never the public feed. */
export interface AdminScheduleItem extends ScheduleItem {
  requiresScan: boolean;
  visibility: "shown" | "hidden";
  publishAt: string | null;
  contactNote: string | null;
  notes: string | null;
  owners: ScheduleOwner[];
}

export interface ScheduleOwner {
  userId: number;
  name: string | null;
  surname: string | null;
  email?: string;
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

export async function addScheduleOwner(scheduleId: number, userId: number): Promise<void> {
  await apiFetch(`/api/schedule/${scheduleId}/owners`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
}

export async function removeScheduleOwner(scheduleId: number, userId: number): Promise<void> {
  await apiFetch(`/api/schedule/${scheduleId}/owners/${userId}`, { method: "DELETE" });
}

export function scheduleTypeLabel(type: string | null | undefined, t: Translate): string {
  const kind =
    type && ACTIVITY_KINDS.includes(type as ActivityKind) ? (type as ActivityKind) : null;
  switch (kind) {
    case "activity":
      return t("typeActivity");
    case "meal":
      return t("typeMeal");
    case "workshop":
      return t("typeWorkshop");
    case "talk":
      return t("typeTalk");
    case "ceremony":
      return t("typeCeremony");
    case "deadline":
      return t("typeDeadline");
    default:
      return t("typeOther");
  }
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

/** True when `[a.startsAt, a.endsAt)` and `[b.startsAt, b.endsAt)` share any time. */
export function entriesOverlap(
  a: Pick<ScheduleItem, "startsAt" | "endsAt">,
  b: Pick<ScheduleItem, "startsAt" | "endsAt">,
): boolean {
  return (
    new Date(a.startsAt).getTime() < new Date(b.endsAt).getTime() &&
    new Date(b.startsAt).getTime() < new Date(a.endsAt).getTime()
  );
}

/** Collapses runs of 2+ blank lines down to one, so author-added gaps don't render as dead space. */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}
