/**
 * Project view models + helpers (H19-H21, #1006).
 *
 * The `@/lib/projects` wrapper types are intentionally permissive
 * (`[k: string]: unknown`). These view types mirror the authoritative backend
 * shapes (`apps/api/src/modules/projects/service.ts`) so pages read exact
 * fields with real types. We coerce the loose wrapper results into these.
 */
import type { PresentationTimingPreference, RepoWithExtras } from "@/lib/projects";

export interface RepoMember {
  userId: number;
  /** null on the participant self-view — teammates' addresses are redacted. */
  email: string | null;
  name: string | null;
  surname: string | null;
}

export interface RepoChallenge {
  id: number;
  title: string;
  mandatory: boolean;
  /** Queue status; null until the challenge's queue is generated. */
  status: string | null;
  position: number | null;
  assignedRoomId: number | null;
  assignedRoomName: string | null;
  etaMinutes: number | null;
  rooms: { id: number; name: string; location: string | null }[];
  /** H36 evaluation status for this challenge — null when the viewer has no
   * visibility into it (e.g. a sponsor viewing a challenge they don't own). */
  reviewStatus: "draft" | "submitted" | null;
  /** Derived headline score (first numeric judging-panel question), same
   * visibility rule as reviewStatus. */
  nota: number | null;
}

export interface ProjectRepo {
  id: number;
  name: string;
  description: string | null;
  github_url: string | null;
  demo_url: string | null;
  presentation_timing_preference: PresentationTimingPreference;
  submission_status: "draft" | "submitted";
  submitted_at: string | null;
  locked_at: string | null;
  members: RepoMember[];
  challenges: RepoChallenge[];
}

export function toProjectRepo(repo: RepoWithExtras): ProjectRepo {
  return repo as unknown as ProjectRepo;
}

/** Judging preference is fixed once any of the project's queues is generated. */
export function timingEditable(repo: ProjectRepo): boolean {
  return repo.challenges.every((challenge) => challenge.status === null);
}

/** A challenge as returned by `/api/challenges` or `/api/public/challenges` —
 * the only fields the projects module's pickers/adders need. */
export interface ChallengeOption {
  id: number;
  title: Record<string, string> | string;
}

/**
 * Human name for a project member, falling back to the email local-part.
 * Returns "" when nothing is available — the self-view redacts teammates'
 * emails, so a nameless teammate has no label to show.
 */
export function memberName(m: {
  name?: string | null;
  surname?: string | null;
  email: string | null;
}): string {
  const full = [m.name, m.surname].filter(Boolean).join(" ").trim();
  return full || m.email?.split("@")[0] || "";
}

/** i18n challenge title from `GET /api/public/challenges` (title is a record);
 * `language` picks that translation first. */
export function challengeTitleText(
  title: Record<string, string> | string | undefined,
  language?: string,
): string {
  if (!title) return "";
  if (typeof title === "string") return title;
  return (language && title[language]) || title.en || title.es || Object.values(title)[0] || "";
}
