import type { FormSection, TemplateField } from "@hackos/shared/forms";
import { apiFetch } from "./api";
import type { Lang } from "./i18n";

export interface NativeProject {
  id: number;
  name: string;
  submissionStatus: "draft" | "submitted";
  responses: Record<string, unknown>;
  revision: number;
  template: TemplateField[];
  sections: FormSection[];
  members: {
    userId: number;
    name: string | null;
    status: "active" | "invited" | "declined";
    photoUrl?: string | null;
  }[];
  challenges: { id: number; title: string; mandatory?: boolean }[];
  presentations: {
    id: number;
    title: string;
    status: string;
    position?: number | null;
  }[];
  winners?: { challengeId: number; rank: number; challengeTitle?: string }[];
  canEdit?: boolean;
  canSubmit?: boolean;
  canInvite?: boolean;
  /** ISO time the phase window closes; shown only when the server provides it. */
  submissionsCloseAt?: string | null;
  files?: {
    objectKey: string;
    url: string;
    thumbnailUrl?: string | null;
    fileName: string;
    mimeType: string;
  }[];
}
export interface ProjectInvite {
  id: number;
  projectId: number;
  name: string;
  invitedBy?: string | null;
}

/** One row of GET /api/queue/me (H38) as My Projects needs it. */
export interface ProjectQueueEntry {
  entryId: number;
  repoId: number;
  challengeTitle: string;
  status: string;
  position: number | null;
  etaMinutes: number | null;
}

/** The queue lines shown under one project row; waiting entries first, by position. */
export function queueBriefFor(entries: ProjectQueueEntry[], projectId: number) {
  const rank = (entry: ProjectQueueEntry) =>
    entry.status === "completed" ? 2 : entry.status === "waiting" ? 1 : 0;
  return entries
    .filter((entry) => entry.repoId === projectId)
    .sort((a, b) => rank(a) - rank(b) || (a.position ?? 1e9) - (b.position ?? 1e9));
}

export function formatEtaMinutes(
  minutes: number | null,
  t: (
    key: "queueAnyMoment" | "queueEtaMinutes" | "queueEtaHours" | "queueEtaHoursMinutes",
    vars?: Record<string, string>,
  ) => string,
) {
  if (minutes == null) return null;
  if (minutes <= 0) return t("queueAnyMoment");
  if (minutes < 60) return t("queueEtaMinutes", { minutes: String(minutes) });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? t("queueEtaHoursMinutes", { hours: String(hours), minutes: String(remainder) })
    : t("queueEtaHours", { hours: String(hours) });
}

export interface GalleryPage {
  items: NativeProject[];
  total: number;
  page: number;
  pageSize: number;
}

export function projectMutation<T>(path: string, method: string, body?: unknown) {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

/** H20: serialize saves so newer answers survive older request completion. */
export class ProjectDraftWriter {
  private responses: Record<string, unknown>;
  private savedGeneration = 0;
  private generation = 0;
  private inFlight: Promise<void> | null = null;
  private disposed = false;
  constructor(
    private revision: number,
    responses: Record<string, unknown>,
    private save: (
      responses: Record<string, unknown>,
      revision: number,
    ) => Promise<{ revision: number }>,
  ) {
    this.responses = responses;
  }
  change(responses: Record<string, unknown>) {
    this.responses = responses;
    this.generation += 1;
  }
  get dirty() {
    return this.savedGeneration !== this.generation;
  }
  resume() {
    this.disposed = false;
  }
  dispose() {
    this.disposed = true;
  }
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  private async drain() {
    while (this.dirty && !this.disposed) {
      const generation = this.generation;
      const result = await this.save(this.responses, this.revision);
      this.revision = result.revision;
      this.savedGeneration = generation;
    }
  }
}

/** The catalogue as the API returns it (`{ items }`, localized titles), in catalogue order. */
export async function fetchChallengeCatalogue(language: Lang) {
  const result = await apiFetch<{
    items: { id: number; title: Partial<Record<Lang, string>> | string }[];
  }>("/api/public/challenges");
  return result.items.map((item) => ({
    id: item.id,
    title:
      typeof item.title === "string"
        ? item.title
        : (item.title[language] ??
          item.title.en ??
          Object.values(item.title)[0] ??
          String(item.id)),
  }));
}
