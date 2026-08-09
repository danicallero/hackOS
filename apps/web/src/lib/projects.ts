/**
 * Typed client for the Devpost intake + projects read/edit API (H16-H17, H20-H21).
 * Shapes mirror `apps/api/src/modules/projects/{plan,service,schemas}.ts`.
 */
import { api } from "./api";

export type MemberMatchType = "primary_email" | "secondary_email" | "unmatched";

export interface PlannedMember {
  email: string;
  name?: string;
  matchType: MemberMatchType;
  userId?: number | null;
  [k: string]: unknown;
}

export interface PlannedRepo {
  title: string;
  url?: string | null;
  action?: "create" | "update";
  members: PlannedMember[];
  prizes?: string[];
  [k: string]: unknown;
}

export interface PlannedPrize {
  name: string;
  lastBatch?: string | null;
  repoCount?: number;
  mappedChallengeId?: number | null;
  mappedChallengeTitle?: string | null;
  [k: string]: unknown;
}

export interface DevpostPrize {
  name: string;
  lastBatch: string | null;
  repoCount: number;
  mappedChallengeId: number | null;
  mappedChallengeTitle: string | null;
}

/** POST /api/devpost/imports/preview | /confirm response (H16). */
export interface ImportPlan {
  repos: PlannedRepo[];
  prizes: PlannedPrize[];
  unassignedParticipants: Array<Record<string, unknown>>;
  totals: {
    repos: number;
    reposToCreate: number;
    reposToUpdate: number;
    members: number;
    membersMatched: number;
    membersUnmatched: number;
    prizes: number;
  };
}

export const listDevpostPrizes = () => api.get<{ prizes: DevpostPrize[] }>("/api/devpost/prizes");

export interface UnmatchedParticipant {
  repoId: number;
  email: string;
  name?: string;
  [k: string]: unknown;
}

/** GET /api/repos | /api/repos/:id (PROJECTS_READ). */
export interface RepoWithExtras {
  id: number;
  name: string;
  url?: string | null;
  members?: Array<{
    userId: number | null;
    email: string;
    name: string | null;
    surname: string | null;
    importedFrom: string;
    externalId: string | null;
    mergeStatus: string;
    matchType: "primary_email" | "secondary_email" | "manual" | "unmatched";
    devpostUsername: string | null;
  }>;
  challenges?: Array<{
    id: number;
    title: string;
    status: string | null;
    position: number | null;
    assignedRoomId: number | null;
    assignedRoomName: string | null;
    mappedPrizes: string[];
    source: "queue" | "prize" | "queue_and_prize";
    reviewStatus: "draft" | "submitted" | null;
    nota: number | null;
  }>;
  unmappedPrizes?: string[];
  [k: string]: unknown;
}

// ── import (H16) ────────────────────────────────────────────────────────────
export const previewImport = (projectsCsv: string, participantsCsv: string) =>
  api.post<ImportPlan>("/api/devpost/imports/preview", { projectsCsv, participantsCsv });

export const confirmImport = (
  projectsCsv: string,
  participantsCsv: string,
  idempotencyKey?: string,
) =>
  api.post<ImportPlan & { created?: unknown }>(
    "/api/devpost/imports/confirm",
    { projectsCsv, participantsCsv },
    idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : undefined,
  );

// ── resolve unmatched (H17) ─────────────────────────────────────────────────
export const listUnmatched = () =>
  api.get<{ participants: UnmatchedParticipant[] }>("/api/devpost/imports/unmatched");
export const linkParticipant = (repoId: number, email: string, userId: number) =>
  api.post("/api/devpost/imports/link", { repoId, email, userId });
export const linkSecondaryEmail = (repoId: number, email: string, userId: number) =>
  api.post("/api/devpost/imports/link-secondary", { repoId, email, userId });
export const sendClaimEmail = (repoId: number, email: string) =>
  api.post("/api/devpost/imports/claim-email", { repoId, email });
export const mapPrize = (prizeName: string, challengeId: number) =>
  api.post(`/api/devpost/prizes/${encodeURIComponent(prizeName)}/map`, { challengeId });

// ── read views ──────────────────────────────────────────────────────────────
export const listRepos = () => api.get<{ repos: RepoWithExtras[] }>("/api/repos");
export const getRepoById = (id: number) => api.get<RepoWithExtras>(`/api/repos/${id}`);
/** H20 participant self-view; canCreate reflects the H19 event policy. */
export const myProjects = () =>
  api.get<{ projects: RepoWithExtras[]; canCreate: boolean }>("/api/me/projects");
export const userProjects = (userId: number) =>
  api.get<{ projects: RepoWithExtras[] }>(`/api/users/${userId}/projects`);

// ── native lifecycle (H18-H19) ─────────────────────────────────────────────
export interface NativeProjectInput {
  name: string;
  description?: string;
  githubUrl?: string | null;
  demoUrl?: string | null;
  challengeIds?: number[];
}

export interface CreatedProject {
  repo: RepoWithExtras;
  challenges: Array<{ challengeId: number; entryId: number; position: number | null }>;
}

// ── hot edit (H21) ─────────────────────────────────────────────────────────
const idem = (key?: string) => (key ? { headers: { "Idempotency-Key": key } } : undefined);

/** POST /api/repos (H18, PROJECTS_EDIT): native creation, no Devpost. */
export const createRepo = (
  input: NativeProjectInput & { memberUserIds?: number[] },
  idempotencyKey?: string,
) => api.post<CreatedProject>("/api/repos", { ...input }, idem(idempotencyKey));

/** PATCH /api/repos/:id (H18): metadata only. */
export const updateRepo = (
  repoId: number,
  patch: Partial<Pick<NativeProjectInput, "name" | "description" | "githubUrl" | "demoUrl">>,
) => api.patch<RepoWithExtras>(`/api/repos/${repoId}`, patch);

/** POST /api/me/projects (H19): participant self-creation, policy-gated. */
export const createMyProject = (input: NativeProjectInput, idempotencyKey?: string) =>
  api.post<CreatedProject>("/api/me/projects", { ...input }, idem(idempotencyKey));

// ── H19/H20 participant self-service: edit, invite, leave, delete ──────────
/** PATCH /api/me/projects/:id — active members only, hacking-window gated. */
export const updateMyProject = (
  repoId: number,
  patch: Partial<Pick<NativeProjectInput, "name" | "description" | "githubUrl" | "demoUrl">>,
) => api.patch<RepoWithExtras>(`/api/me/projects/${repoId}`, patch);

/** POST /api/me/projects/:id/invites — invite a teammate by email. */
export const inviteProjectMember = (repoId: number, email: string, idempotencyKey?: string) =>
  api.post(`/api/me/projects/${repoId}/invites`, { email }, idem(idempotencyKey));

export interface PendingInvite {
  repoId: number;
  repoName: string;
  invitedByName: string | null;
  invitedAt: string;
}

/** GET /api/me/projects/invites — invites addressed to the caller. */
export const myPendingInvites = () =>
  api.get<{ invites: PendingInvite[] }>("/api/me/projects/invites");

export const acceptProjectInvite = (repoId: number, idempotencyKey?: string) =>
  api.post(`/api/me/projects/invites/${repoId}/accept`, {}, idem(idempotencyKey));
export const declineProjectInvite = (repoId: number, idempotencyKey?: string) =>
  api.post(`/api/me/projects/invites/${repoId}/decline`, {}, idem(idempotencyKey));

export const leaveMyProject = (repoId: number, idempotencyKey?: string) =>
  api.delete(`/api/me/projects/${repoId}/leave`, idem(idempotencyKey));
export const deleteMyProject = (repoId: number, idempotencyKey?: string) =>
  api.delete(`/api/me/projects/${repoId}`, idem(idempotencyKey));

export const addRepoMember = (repoId: number, userId: number, idempotencyKey?: string) =>
  api.post(`/api/repos/${repoId}/members`, { userId }, idem(idempotencyKey));
export const removeRepoMember = (repoId: number, userId: number) =>
  api.delete(`/api/repos/${repoId}/members/${userId}`);
export const removeDevpostParticipant = (repoId: number, email: string) =>
  api.delete(`/api/repos/${repoId}/devpost-participants/${encodeURIComponent(email)}`);
export const addRepoChallenge = (repoId: number, challengeId: number, idempotencyKey?: string) =>
  api.post(`/api/repos/${repoId}/challenges`, { challengeId }, idem(idempotencyKey));
export const removeRepoChallenge = (repoId: number, challengeId: number) =>
  api.delete(`/api/repos/${repoId}/challenges/${challengeId}`);
export const removeRepoPrize = (repoId: number, prizeName: string) =>
  api.delete(`/api/repos/${repoId}/prizes/${encodeURIComponent(prizeName)}`);
