/**
 * Typed client for the queue/judging API (H29-H40). Thin wrappers over `@/lib/api`
 * mirroring the read shapes in `apps/api/src/modules/queue/{reads,types}.ts`.
 * Keep these in sync with the backend; when a shape is unclear, read the module.
 */
import { api } from "./api";

/** Physical stages a team moves through (plan §5; queue_entries.status). */
export type QueueStatus =
  | "waiting"
  | "called"
  | "in_room"
  | "presenting"
  | "completed"
  | "disqualified";

export interface QueueEntry {
  id: number;
  challenge_id: number;
  repo_id: number;
  assigned_room_id: number | null;
  status: QueueStatus | string;
  position: number | null;
  priority: number;
  call_count: number;
  called_at: string | null;
  presentation_started_at: string | null;
  completed_at: string | null;
  precalled_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined into read models. */
  repo_name?: string;
}

export interface Room {
  id: number;
  name: string;
  slug: string;
  location: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RoomQueueState {
  room_id: number;
  is_paused: boolean;
  max_in_waiting_area: number;
  desired_minutes_per_team: number;
  started_at: string | null;
  updated_at: string;
}

export interface QueueSettings {
  id: number;
  handoff_buffer_minutes: number;
  schedule_start_at: string | null;
  schedule_end_at: string | null;
  pre_call_notification_eta_minutes: number;
  requeue_prompt_default: "top" | "bottom" | "ask";
}

/** GET /api/queue/rooms/:id/view — feeds operator panels and TV (H41). */
export interface RoomView {
  room: Room;
  state: RoomQueueState | null;
  active: QueueEntry | null;
  called: QueueEntry[];
  next: QueueEntry[];
}

/** GET /api/queue/challenges/:id/progress (H40). */
export interface ChallengeProgress {
  challengeId: number;
  waiting: number;
  called: number;
  inProgress: number;
  evaluated: number;
  disqualified: number;
  other: number;
  byStatus: Record<string, number>;
}

/** GET /api/queue/rooms/:id/pace (H39). */
export interface RoomPace {
  roomId: number;
  desiredMinutesPerTeam: number;
  pendingCount: number;
  remainingMinutes: number | null;
  requiredMinutes: number;
  insufficientTime: boolean;
  suggestedMinutesPerTeam: number | null;
  autoAdjusted: boolean;
  effectiveMinutesPerTeam: number;
}

export interface RoomChallengeAssignment {
  challenge_id: number;
  title: string;
  visibility: string;
  assigned_at: string;
  assigned_by: number | null;
  assigned_by_name: string | null;
  assigned_by_surname: string | null;
  assigned_by_email: string | null;
}

export interface RoomJudgeAssignment {
  challenge_id: number;
  title: string;
  user_id: number;
  name: string | null;
  surname: string | null;
  email: string;
  assigned_at: string;
  assigned_by: number | null;
  assigned_by_name: string | null;
  assigned_by_surname: string | null;
  assigned_by_email: string | null;
}

export interface RoomAssignments {
  roomId: number;
  room: Room;
  challenges: RoomChallengeAssignment[];
  judges: RoomJudgeAssignment[];
}

/** GET /api/queue/me — participant view (H38). */
export interface MyQueueEntry {
  challengeId: number;
  challengeTitle: string;
  repoId: number;
  repoName: string;
  status: QueueStatus | string;
  position: number | null;
  etaMinutes: number | null;
  calledAt: string | null;
  roomId: number | null;
}

// ── reads ────────────────────────────────────────────────────────────────
export const getRoomView = (roomId: number) => api.get<RoomView>(`/api/queue/rooms/${roomId}/view`);
export const getAllRoomViews = () => api.get<RoomView[]>("/api/tv/rooms");
export const getChallengeProgress = (challengeId: number) =>
  api.get<ChallengeProgress>(`/api/queue/challenges/${challengeId}/progress`);
export const getRoomPace = (roomId: number) => api.get<RoomPace>(`/api/queue/rooms/${roomId}/pace`);
export const getRoomAssignments = (roomId: number) =>
  api.get<RoomAssignments>(`/api/queue/rooms/${roomId}/assignments`);
export const getMyQueue = () => api.get<MyQueueEntry[]>("/api/queue/me");
export const listRooms = () => api.get<Room[]>("/api/queue/rooms");
/** GET /api/queue/rooms/:id → room fields + attached queue state (not a RoomView). */
export const getRoom = (roomId: number) =>
  api.get<Room & { queueState: RoomQueueState | null }>(`/api/queue/rooms/${roomId}`);
export const getQueueSettings = () => api.get<QueueSettings>("/api/queue/settings");

// ── room control (H29, H35) ────────────────────────────────────────────────
const idem = (key?: string) => (key ? { headers: { "Idempotency-Key": key } } : undefined);

export const callNext = (roomId: number, idempotencyKey?: string, force?: boolean) =>
  api.post(`/api/queue/rooms/${roomId}/call-next`, force ? { force } : {}, idem(idempotencyKey));
export const pauseRoom = (roomId: number, idempotencyKey?: string) =>
  api.post(`/api/queue/rooms/${roomId}/pause`, {}, idem(idempotencyKey));
export const resumeRoom = (roomId: number, idempotencyKey?: string) =>
  api.post(`/api/queue/rooms/${roomId}/resume`, {}, idem(idempotencyKey));
export const createRoom = (
  body: { name: string; slug: string; location?: string | null },
  idempotencyKey?: string,
) => api.post<Room>("/api/queue/rooms", body, idem(idempotencyKey));
export const updateRoom = (
  roomId: number,
  body: Partial<Pick<Room, "name" | "slug" | "location" | "status">>,
) => api.patch<Room>(`/api/queue/rooms/${roomId}`, body);
export const deleteRoom = (roomId: number) => api.delete(`/api/queue/rooms/${roomId}`);
export const updateRoomState = (roomId: number, body: { desiredMinutesPerTeam?: number }) =>
  api.patch<RoomQueueState>(`/api/queue/rooms/${roomId}/state`, body);
export const updateQueueSettings = (
  body: Partial<
    Pick<
      QueueSettings,
      | "handoff_buffer_minutes"
      | "schedule_start_at"
      | "schedule_end_at"
      | "pre_call_notification_eta_minutes"
      | "requeue_prompt_default"
    >
  >,
) => api.patch<QueueSettings>("/api/queue/settings", body);
export const assignRoomChallenge = (roomId: number, challengeId: number) =>
  api.post(`/api/queue/rooms/${roomId}/challenges`, { challengeId });
export const removeRoomChallenge = (roomId: number, challengeId: number) =>
  api.delete(`/api/queue/rooms/${roomId}/challenges/${challengeId}`);
export const assignRoomJudge = (roomId: number, challengeId: number, userId: number) =>
  api.post(`/api/queue/rooms/${roomId}/judges`, { challengeId, userId });
export const removeRoomJudge = (roomId: number, challengeId: number, userId: number) =>
  api.delete(`/api/queue/rooms/${roomId}/judges/${challengeId}/${userId}`);
export const enqueueAllChallengeQueues = (idempotencyKey?: string) =>
  api.post<{
    challenges: Array<{ challengeId: number; inserted: number; alreadyQueued: number }>;
    inserted: number;
    alreadyQueued: number;
  }>("/api/queue/challenges/enqueue-all", {}, idem(idempotencyKey));

// ── entry transitions (H30-H34) ────────────────────────────────────────────
// Critical mutations accept an Idempotency-Key; pass a fresh uuid to dedupe
// double-clicks/retries (apps/api/src/lib/idempotency.ts).
type EntryAction =
  | "notify-enter"
  | "bring-in"
  | "start"
  | "complete"
  | "send-back"
  | "re-enter"
  | "requeue"
  | "no-show"
  | "skip"
  | "cancel"
  | "disqualify"
  | "manual-call";
export const entryAction = <T = unknown>(
  entryId: number,
  action: EntryAction,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
) => api.post<T>(`/api/queue/entries/${entryId}/${action}`, body, idem(idempotencyKey));
export const getEntryHistory = (entryId: number) =>
  api.get(`/api/queue/entries/${entryId}/history`);

// ── judging / evaluation (H36-H37) ─────────────────────────────────────────
export interface AttemptReview {
  attempt_id: number;
  scores: Record<string, unknown>;
  notes: string | null;
  status: "draft" | "submitted" | string;
  created_at?: string;
  updated_at?: string;
}

export interface JudgingSession {
  id: number;
  judge_id: number;
  queue_entry_id: number;
  room_id: number | null;
  started_at: string;
  ended_at: string | null;
  name?: string;
  surname?: string;
}

export interface QueueSearchResult extends QueueEntry {
  has_review: boolean;
  review_status: string | null;
}

export const getReview = (entryId: number) =>
  api.get<AttemptReview>(`/api/queue/entries/${entryId}/review`);
export const saveReview = (entryId: number, body: Record<string, unknown>) =>
  api.patch<AttemptReview>(`/api/queue/entries/${entryId}/review`, body);
export const getReviewVersions = (entryId: number) =>
  api.get(`/api/queue/entries/${entryId}/review/versions`);
export const openSession = (entryId: number, roomId?: number) =>
  api.post<JudgingSession>(`/api/queue/entries/${entryId}/session`, { roomId });
export const closeSession = (entryId: number) =>
  api.delete(`/api/queue/entries/${entryId}/session`);
export const getSessions = (entryId: number) =>
  api.get<JudgingSession[]>(`/api/queue/entries/${entryId}/sessions`);
export const searchTeams = (challengeId: number, q: string) =>
  api.get<QueueSearchResult[]>(`/api/queue/challenges/${challengeId}/search`, { query: { q } });

/** CSV export URLs (open directly — credentialed download) (H40). */
export const exportUrls = (challengeId: number) => ({
  queue: `/api/queue/challenges/${challengeId}/export/queue.csv`,
  evaluations: `/api/queue/challenges/${challengeId}/export/evaluations.csv`,
});
