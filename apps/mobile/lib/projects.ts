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
  githubUrl?: string | null;
  canEdit?: boolean;
  canSubmit?: boolean;
  /** Inside the submission window a team withdraws a submitted project to edit it. */
  canWithdraw?: boolean;
  canInvite?: boolean;
  /** ISO time the phase window closes; shown only when the server provides it. */
  submissionsCloseAt?: string | null;
  files?: ProjectFile[];
}
export interface ProjectFile {
  objectKey: string;
  url: string;
  thumbnailUrl?: string | null;
  fileName: string;
  mimeType: string;
  size?: number;
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
  /** The newest local answers, saved or not. */
  get current() {
    return this.responses;
  }
  get dirty() {
    return this.savedGeneration !== this.generation;
  }
  get saving() {
    return this.inFlight !== null;
  }
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  private async drain() {
    while (this.dirty) {
      const generation = this.generation;
      const result = await this.save(this.responses, this.revision);
      this.revision = result.revision;
      this.savedGeneration = generation;
    }
  }
}

/**
 * H20: one draft writer per project for the whole app session. Closing the
 * editor (back button, swipe, upload still running) never drops answers: the
 * writer keeps saving, and a reopened editor waits for it or resumes from the
 * answers it could not save yet.
 */
const draftWriters = new Map<number, ProjectDraftWriter>();
const draftTasks = new Map<number, Set<Promise<unknown>>>();

export function projectDraftWriter(project: Pick<NativeProject, "id" | "revision" | "responses">) {
  const existing = draftWriters.get(project.id);
  if (existing && (existing.dirty || existing.saving)) return existing;
  const writer = new ProjectDraftWriter(project.revision, project.responses, (answers, revision) =>
    projectMutation<{ revision: number }>(`/api/me/projects/${project.id}/draft`, "PUT", {
      responses: answers,
      revision,
    }),
  );
  draftWriters.set(project.id, writer);
  return writer;
}

/** Forget unsaved answers after a conflict, so the server copy is loaded as is. */
export function discardProjectDraft(id: number) {
  draftWriters.delete(id);
}

/** Keep work that must finish even if its screen closes (uploads, name changes). */
export function trackProjectTask<T>(id: number, task: Promise<T>): Promise<T> {
  const tasks = draftTasks.get(id) ?? new Set<Promise<unknown>>();
  draftTasks.set(id, tasks);
  tasks.add(task);
  const done = () => tasks.delete(task);
  task.then(done, done);
  return task;
}

/** Wait until pending uploads and saves for one project (or all) have settled. */
export async function settleProjectDrafts(id?: number) {
  const ids =
    id === undefined ? [...new Set([...draftTasks.keys(), ...draftWriters.keys()])] : [id];
  await Promise.allSettled(
    ids.flatMap((projectId) => [
      ...(draftTasks.get(projectId) ?? []),
      draftWriters.get(projectId)?.flush() ?? Promise.resolve(),
    ]),
  );
  // An upload that finished while waiting may have queued one more save.
  await Promise.allSettled(ids.map((projectId) => draftWriters.get(projectId)?.flush()));
}

type Localized = Partial<Record<Lang, string>> | string | null | undefined;

function localized(value: Localized, language: Lang) {
  if (value == null || typeof value === "string") return value ?? "";
  return value[language] || value.en || Object.values(value).find(Boolean) || "";
}

/** One published challenge as GET /api/public/challenges returns it (H45). */
interface PublicChallengeRow {
  id: number;
  title: Localized;
  description?: Localized;
  criteria?: Localized;
  prizes?: unknown[];
  enterprise?: { id: number; name: string; logoUrl: string | null; website: string | null };
}

export interface ChallengeDetail {
  id: number;
  title: string;
  description: string;
  criteria: string;
  prizes: string[];
  company: { id: number; name: string; logoUrl: string | null; website: string | null } | null;
}

function prizeText(prize: unknown, language: Lang): string {
  if (typeof prize === "string") return prize;
  if (!prize || typeof prize !== "object") return "";
  const item = prize as { title?: Localized; name?: Localized; description?: Localized };
  return localized(item.title ?? item.name ?? item.description, language);
}

function challengeDetail(item: PublicChallengeRow, language: Lang): ChallengeDetail {
  return {
    id: item.id,
    title: localized(item.title, language) || String(item.id),
    description: localized(item.description, language).trim(),
    criteria: localized(item.criteria, language).trim(),
    prizes: (item.prizes ?? []).map((prize) => prizeText(prize, language)).filter(Boolean),
    company: item.enterprise ?? null,
  };
}

/** The catalogue as the API returns it (`{ items }`, localized titles), in catalogue order. */
export async function fetchChallengeCatalogue(language: Lang) {
  const result = await apiFetch<{ items: PublicChallengeRow[] }>("/api/public/challenges");
  return result.items.map((item) => challengeDetail(item, language));
}

/** H45: a challenge's public brief; null once it is no longer published. */
export async function fetchChallengeDetail(language: Lang, id: number) {
  return (await fetchChallengeCatalogue(language)).find((item) => item.id === id) ?? null;
}

/**
 * Reuses every unchanged project object, so a refresh only touches rows that
 * were added, changed or removed and returns the same array when nothing did.
 */
export function mergeProjects(current: NativeProject[], next: NativeProject[]): NativeProject[] {
  const byId = new Map(current.map((project) => [project.id, project]));
  const merged = next.map((project) => {
    const existing = byId.get(project.id);
    return existing && JSON.stringify(existing) === JSON.stringify(project) ? existing : project;
  });
  return merged.length === current.length && merged.every((project, i) => project === current[i])
    ? current
    : merged;
}
