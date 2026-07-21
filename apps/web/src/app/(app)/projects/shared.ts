/**
 * WS-A local view models + helpers (H16, H17, H20).
 *
 * The WS0 `@/lib/projects` wrapper types are intentionally permissive
 * (`[k: string]: unknown`) and a few field names differ from the real API.
 * These view types mirror the AUTHORITATIVE backend shapes
 * (`apps/api/src/modules/projects/{plan,service,csv}.ts`) so pages can read
 * exact fields with real types. We coerce the loose wrapper results into these
 * — we never re-implement the wrappers themselves.
 */
import type { Translate } from "@/lib/i18n";
import type {
  ImportPlan,
  MemberMatchType,
  RepoWithExtras,
  UnmatchedParticipant,
} from "@/lib/projects";
import type { Tone } from "@/lib/tones";

// ── read views (GET /api/repos, /api/repos/:id) — service.ts RepoWithExtras ──

export interface RepoMember {
  userId: number | null;
  /** null on the participant self-view — teammates' addresses are redacted. */
  email: string | null;
  name: string | null;
  surname: string | null;
  importedFrom: string;
  externalId: string | null;
  mergeStatus: string;
  devpostUsername: string | null;
}

export interface RepoChallenge {
  id: number;
  title: string;
  status: string | null;
  position: number | null;
  assignedRoomId: number | null;
  assignedRoomName: string | null;
  mappedPrizes: string[];
  source: "queue" | "prize" | "queue_and_prize";
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
  devpost_url: string | null;
  demo_url: string | null;
  members: RepoMember[];
  prizes: string[];
  unmappedPrizes: string[];
  challenges: RepoChallenge[];
}

export function toProjectRepo(repo: RepoWithExtras): ProjectRepo {
  return repo as unknown as ProjectRepo;
}

/**
 * Unified project↔challenge/prize row (H16, H21). Prizes/challenges used to be
 * two separate lists on the project page, which duplicated any prize already
 * mapped to a challenge (it showed once as a challenge row and again as a
 * prize row). A mapped prize always ends up inside `repo.challenges` (source
 * "prize"/"queue_and_prize"), so the only prizes needing their own row are the
 * ones in `repo.unmappedPrizes` — this merges both into one ordered list with
 * no duplicates.
 */
export type UnifiedProjectEntry =
  | { kind: "challenge"; challenge: RepoChallenge }
  | { kind: "unmapped_prize"; prize: string };

export function toUnifiedEntries(repo: ProjectRepo): UnifiedProjectEntry[] {
  return [
    ...repo.challenges.map((challenge): UnifiedProjectEntry => ({ kind: "challenge", challenge })),
    ...repo.unmappedPrizes.map((prize): UnifiedProjectEntry => ({ kind: "unmapped_prize", prize })),
  ];
}

// ── unmatched (GET /api/devpost/imports/unmatched) — service.ts UnmatchedParticipant ──

export interface UnmatchedRow {
  repo_id: number;
  repo_name: string;
  email: string;
  name: string | null;
  surname: string | null;
  devpost_username: string | null;
  import_batch: string;
  claim_email_sent_at: string | null;
  created_at: string;
}

export function toUnmatchedRow(row: UnmatchedParticipant): UnmatchedRow {
  return row as unknown as UnmatchedRow;
}

// ── import plan (POST .../preview | /confirm) — plan.ts ImportPlan ──

export interface PlanMember {
  email: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  matchedUserId: number | null;
  matchedUserName: string | null;
  matchType: MemberMatchType;
}

export interface PlanRepo {
  title: string;
  url: string | null;
  description: string;
  demoUrl: string | null;
  prizes: string[];
  members: PlanMember[];
  existingRepoId: number | null;
  action: "create" | "update";
}

export interface PlanPrize {
  name: string;
  repoCount: number;
  mappedChallengeId: number | null;
  mappedChallengeTitle: string | null;
}

/** One row from `csv.ts` DevpostParticipantRow (plan.unassignedParticipants). */
export interface UnassignedRow {
  email: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  projectRef: string | null;
}

export interface ImportPlanView {
  repos: PlanRepo[];
  prizes: PlanPrize[];
  unassignedParticipants: UnassignedRow[];
  totals: ImportPlan["totals"];
}

export function toImportPlanView(plan: ImportPlan): ImportPlanView {
  return plan as unknown as ImportPlanView;
}

/** POST .../confirm response — service.ts ConfirmImportResult. */
export interface ConfirmResult {
  batchId: string;
  counts: {
    reposCreated: number;
    reposUpdated: number;
    participantsMatched: number;
    participantsUnmatched: number;
    prizesSeen: number;
    prizesUnmapped: number;
  };
  repos: Array<{ id: number; title: string; action: "create" | "update" }>;
}

// ── display helpers ──────────────────────────────────────────────────────────

/**
 * Human name for a project member, falling back to the Devpost handle and then
 * to the email local-part. Returns "" when nothing is available — the self-view
 * redacts teammates' emails, so a nameless teammate has no label to show.
 */
export function memberName(m: {
  name?: string | null;
  surname?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  devpostUsername?: string | null;
  email: string | null;
}): string {
  const parts = [m.name ?? m.firstName, m.surname ?? m.lastName].filter(Boolean);
  const full = parts.join(" ").trim();
  return full || m.devpostUsername || m.email?.split("@")[0] || "";
}

const MATCH_TONE: Record<MemberMatchType, Tone> = {
  primary_email: "success",
  secondary_email: "info",
  unmatched: "warning",
};

export function matchTone(type: MemberMatchType): Tone {
  return MATCH_TONE[type] ?? "neutral";
}

export function matchLabel(type: MemberMatchType, t: Translate): string {
  const map: Record<MemberMatchType, string> = {
    primary_email: t("matchedLabel"),
    secondary_email: t("matchedSecondaryLabel"),
    unmatched: t("unmatchedBadge"),
  };
  return map[type] ?? type;
}

/** merge_status on a persisted devpost_participant → tone. */
export function mergeStatusTone(status: string): Tone {
  if (status === "unmatched") return "warning";
  if (status === "manually_linked") return "info";
  if (status === "manual") return "neutral";
  return "success"; // auto_matched, etc.
}

export function mergeStatusLabel(status: string): string {
  if (status === "manual") return "manual";
  return status.replace(/_/g, " ");
}

/** i18n challenge title from `GET /api/public/challenges` (title is a record). */
export function challengeTitleText(title: Record<string, string> | string | undefined): string {
  if (!title) return "";
  if (typeof title === "string") return title;
  return title.en || title.es || Object.values(title)[0] || "";
}
