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
    devpostUsername: string | null;
  }>;
  challenges?: Array<{
    id: number;
    title: string;
    status: string;
    position: number | null;
    assignedRoomId: number | null;
    assignedRoomName: string | null;
  }>;
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
export const myProjects = () => api.get<RepoWithExtras[]>("/api/me/projects");

// ── hot edit (H21) ─────────────────────────────────────────────────────────
const idem = (key?: string) => (key ? { headers: { "Idempotency-Key": key } } : undefined);

export const addRepoMember = (repoId: number, userId: number, idempotencyKey?: string) =>
  api.post(`/api/repos/${repoId}/members`, { userId }, idem(idempotencyKey));
export const removeRepoMember = (repoId: number, userId: number) =>
  api.delete(`/api/repos/${repoId}/members/${userId}`);
export const addRepoChallenge = (repoId: number, challengeId: number, idempotencyKey?: string) =>
  api.post(`/api/repos/${repoId}/challenges`, { challengeId }, idem(idempotencyKey));
export const removeRepoChallenge = (repoId: number, challengeId: number) =>
  api.delete(`/api/repos/${repoId}/challenges/${challengeId}`);
