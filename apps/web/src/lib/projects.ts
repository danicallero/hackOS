/**
 * Typed client for the projects API: one project entity from draft to
 * submission (H19-H21, #1006). Shapes mirror
 * `apps/api/src/modules/projects/{service,lifecycle,schemas}.ts`.
 */
import { api } from "./api";

export type PresentationTimingPreference = "no_preference" | "early" | "middle" | "late";

/** GET /api/repos | /api/repos/:id (PROJECTS_READ) and the participant self-view. */
export interface RepoWithExtras {
  id: number;
  name: string;
  description?: string | null;
  github_url?: string | null;
  demo_url?: string | null;
  presentation_timing_preference?: PresentationTimingPreference;
  submission_status?: "draft" | "submitted";
  submitted_at?: string | null;
  submitted_via?: "participant" | "admin" | null;
  locked_at?: string | null;
  lock_reason?: "organizer_lock" | null;
  members?: Array<{
    userId: number;
    email: string | null;
    name: string | null;
    surname: string | null;
  }>;
  challenges?: Array<{
    id: number;
    title: string;
    mandatory: boolean;
    status: string | null;
    position: number | null;
    assignedRoomId: number | null;
    assignedRoomName: string | null;
    etaMinutes: number | null;
    rooms: { id: number; name: string; location: string | null }[];
    reviewStatus: "draft" | "submitted" | null;
    nota: number | null;
  }>;
  [k: string]: unknown;
}

// ── read views ──────────────────────────────────────────────────────────────
export const listRepos = () => api.get<{ repos: RepoWithExtras[] }>("/api/repos");
export const getRepoById = (id: number) => api.get<RepoWithExtras>(`/api/repos/${id}`);
/** H20 participant self-view; canCreate reflects the H19 event policy. */
export const myProjects = () =>
  api.get<{ projects: RepoWithExtras[]; canCreate: boolean }>("/api/me/projects");
export const userProjects = (userId: number) =>
  api.get<{ projects: RepoWithExtras[] }>(`/api/users/${userId}/projects`);

// ── creation (H19, H21) ────────────────────────────────────────────────────
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

/** POST /api/repos (H21, PROJECTS_EDIT): staff create a project on a team's behalf. */
export const createRepo = (
  input: NativeProjectInput & { memberUserIds?: number[] },
  idempotencyKey?: string,
) => api.post<CreatedProject>("/api/repos", { ...input }, idem(idempotencyKey));

export type ProjectPatch = Partial<
  Pick<NativeProjectInput, "name" | "description" | "githubUrl" | "demoUrl">
> & { presentationTimingPreference?: PresentationTimingPreference };

/** PATCH /api/repos/:id (H21): metadata and judging preference. */
export const updateRepo = (repoId: number, patch: ProjectPatch) =>
  api.patch<RepoWithExtras>(`/api/repos/${repoId}`, patch);

/** POST /api/me/projects (H19): a participant creates a draft, policy-gated. */
export const createMyProject = (input: NativeProjectInput, idempotencyKey?: string) =>
  api.post<CreatedProject>("/api/me/projects", { ...input }, idem(idempotencyKey));

// ── H19/H20 participant self-service: edit, invite, leave, delete ──────────
/** PATCH /api/me/projects/:id — active members only, participant-window gated. */
export const updateMyProject = (repoId: number, patch: ProjectPatch) =>
  api.patch<RepoWithExtras>(`/api/me/projects/${repoId}`, patch);

/** Participant enrollment stays available only until judging starts. */
export const addMyProjectChallenge = (
  repoId: number,
  challengeId: number,
  idempotencyKey?: string,
) => api.post(`/api/me/projects/${repoId}/challenges`, { challengeId }, idem(idempotencyKey));
export const removeMyProjectChallenge = (
  repoId: number,
  challengeId: number,
  idempotencyKey?: string,
) => api.delete(`/api/me/projects/${repoId}/challenges/${challengeId}`, idem(idempotencyKey));

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
export const addRepoChallenge = (repoId: number, challengeId: number, idempotencyKey?: string) =>
  api.post(`/api/repos/${repoId}/challenges`, { challengeId }, idem(idempotencyKey));
export const removeRepoChallenge = (repoId: number, challengeId: number) =>
  api.delete(`/api/repos/${repoId}/challenges/${challengeId}`);

/** GET /api/me/projects/:id/submission and each row of GET /api/projects/submissions. */
export interface ProjectSubmission {
  id: number;
  name: string;
  status: "draft" | "submitted";
  submittedVia: "participant" | "admin" | null;
  submittedAt: string | null;
  changedSinceSubmit: boolean;
  lockedAt: string | null;
  lockReason: "organizer_lock" | null;
  eligible: boolean;
  participantCount: number;
  maxTeamSize: number | null;
  teamSizeViolation: boolean;
  teamSizeException: boolean;
  eligibilityOverride: boolean | null;
  requests: Array<{
    id: number;
    reason: string;
    status: "pending" | "approved" | "denied";
    created_at: string;
    decision_reason: string | null;
  }>;
  canSubmit: boolean;
}
export const projectSubmission = (id: number) =>
  api.get<ProjectSubmission>(`/api/me/projects/${id}/submission`);
export const submitProject = (id: number) =>
  api.post<{ repoId: number }>(`/api/me/projects/${id}/submit`, {}, idem(crypto.randomUUID()));
export const requestProjectEdits = (id: number, reason: string) =>
  api.post(`/api/me/projects/${id}/edit-requests`, { reason }, idem(crypto.randomUUID()));
export const projectSubmissions = () =>
  api.get<{
    projects: ProjectSubmission[];
    config: { maxTeamSize: number | null; deadline: string | null };
  }>("/api/projects/submissions");
export const decideProjectEdits = (
  id: number,
  decision: "approve" | "deny" | "unlock",
  reason: string,
) => api.post(`/api/projects/${id}/unlock`, { decision, reason }, idem(crypto.randomUUID()));
export const resolveProjectException = (
  id: number,
  body: {
    reason: string;
    teamSizeException?: boolean;
    eligibilityOverride?: boolean | null;
  },
) => api.post(`/api/projects/${id}/resolve`, body, idem(crypto.randomUUID()));
