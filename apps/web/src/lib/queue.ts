/**
 * Typed client for the queue/judging API (H29-H40). Thin wrappers over `@/lib/api`
 * mirroring the read shapes in `apps/api/src/modules/queue/{reads,types}.ts`.
 * Keep these in sync with the backend; when a shape is unclear, read the module.
 */
import type { Question } from "@hackos/shared/questions";
import type { TranslatedText } from "@/app/(app)/challenges/shared";
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
  repo_description?: string | null;
  repo_github_url?: string | null;
  repo_devpost_url?: string | null;
  repo_demo_url?: string | null;
  repo_members?: Array<{
    /** Null when the Devpost participant never matched a system account. */
    userId: number | null;
    email: string;
    name: string | null;
    surname: string | null;
  }>;
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
  /**
   * The queue this room serves (read-only in the panel), named by its queue
   * group: a challenge title while the group holds one challenge, the
   * admin-chosen shared name once several are merged (H46). `criteria` is the
   * one judging form every team in this queue is scored with.
   */
  challenge: {
    id: number;
    title: string;
    enterprise_name: string;
    queue_group_id: number;
    /** Operator/judge feed only — the public TV projection omits both. */
    challenge_count?: number;
    judging_panel_criteria?: Question[] | null;
  } | null;
  active: QueueEntry | null;
  called: QueueEntry[];
  next: QueueEntry[];
  /** Waiting teams temporarily blocked by a member active at another room. */
  crossRoomSkips: CrossRoomSkip[];
}

export interface CrossRoomSkip {
  entryId: number;
  position: number | null;
  blockingRoomId: number;
  blockingRoomName: string;
  blockingTeamName: string;
  blockingStatus: string;
  positionPreserved: true;
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
  /** Avg minutes/team across every room judging this challenge; null with no completed teams yet. */
  avgEvaluationMinutes: number | null;
}

/** GET /api/queue/rooms/:id/pace (H39). */
export interface RoomPace {
  roomId: number;
  desiredMinutesPerTeam: number;
  /** The challenge's own max_presentation_seconds, in minutes; null if unset. */
  challengeMaxMinutes: number | null;
  /** Rooms (across the event) sharing this challenge's queue. */
  roomCount: number;
  pendingCount: number;
  remainingMinutes: number | null;
  requiredMinutes: number;
  insufficientTime: boolean;
  suggestedMinutesPerTeam: number | null;
  autoAdjusted: boolean;
  effectiveMinutesPerTeam: number;
  /** H34/H203: operator-configured called-too-long warning threshold. */
  calledTooLongThresholdMinutes: number;
}

export interface RoomChallengeAssignment {
  challenge_id: number;
  title: string;
  visibility: string;
  queue_group_id: number;
  queue_group_name: string;
  assigned_at: string;
  assigned_by: number | null;
  assigned_by_name: string | null;
  assigned_by_surname: string | null;
  assigned_by_email: string | null;
}

/**
 * Read-only: judges are rostered on the enterprise that owns the room's
 * challenge (`/api/enterprises/:id/judges`), not on the room itself.
 */
export interface RoomJudgeAssignment {
  queue_group_id: number;
  enterprise_id: number;
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

/** The queue group a room serves; null when the room is unassigned. */
export interface RoomQueueGroupAssignment {
  id: number;
  display_name: string;
  enterprise_id: number;
  enterprise_name: string;
  assigned_at: string;
  assigned_by: number | null;
  assigned_by_name: string | null;
  assigned_by_surname: string | null;
  assigned_by_email: string | null;
}

export interface RoomAssignments {
  roomId: number;
  room: Room;
  queueGroup: RoomQueueGroupAssignment | null;
  /** Every challenge the room judges, via its queue group. */
  challenges: RoomChallengeAssignment[];
  judges: RoomJudgeAssignment[];
}

/**
 * One judging queue. A queue with more than one challenge is a *shared*
 * queue: one line in every list, one call per team, one judging form (H46).
 *
 * `GET /api/queue/groups` returns every queue the caller may manage (all of
 * them for a queue/sponsor administrator, their own enterprises' for a rep)
 * and `GET /api/enterprises/:id/queue-groups` the same shape for one
 * enterprise — so the room-assignment picker and the all-queues management
 * view share this type.
 */
export interface QueueGroup {
  id: number;
  enterpriseId: number;
  enterpriseName: string;
  enterpriseLogoUrl: string | null;
  enterpriseLogoNegativeUrl: string | null;
  displayName: string;
  challenges: Array<{ id: number; title: string }>;
  rooms: Array<{ id: number; name: string }>;
  criteria: Question[] | null;
  /** Distinct teams queued for it — a team in two of its challenges is one. */
  teams: number;
  shared: boolean;
  /**
   * Whether any team in this queue has been evaluated. Merging, splitting and
   * editing the merged judging form are refused from that moment — and only
   * from that moment: a queue that exists, or is being called from, is still
   * configurable.
   */
  evaluationStarted: boolean;
}

export interface AssignableRoom {
  id: number;
  name: string;
  queueGroupId: number | null;
}

/**
 * GET /api/queue/groups/:id/queue — one judging queue in call order. A team
 * queued for several of a shared queue's challenges is one entry, at its best
 * position, exactly as the callable queue dedupes it.
 */
export interface QueueGroupQueue {
  group: {
    id: number;
    display_name: string;
    enterprise_id: number;
    enterprise_name: string;
  };
  challenges: Array<{ id: number; title: string }>;
  entries: Array<{
    id: number;
    repo_id: number;
    repo_name: string;
    challenge_id: number;
    challenge_title: string;
    status: QueueStatus;
    position: number | null;
    called_at: string | null;
    assigned_room_id: number | null;
    room_name: string | null;
    queued_challenge_ids: number[];
    has_review: boolean;
    review_status: "draft" | "submitted" | null;
  }>;
}

export const getQueueGroupQueue = (queueGroupId: number) =>
  api.get<QueueGroupQueue>(`/api/queue/groups/${queueGroupId}/queue`);

export interface MergedPanelPreview {
  questions: Question[];
  duplicatesDropped: number;
  renamedKeys: Array<{ from: string; to: string }>;
}

/** One enterprise's queues. `listQueueGroups` is the cross-enterprise view. */
export const listEnterpriseQueueGroups = (enterpriseId: number) =>
  api
    .get<{ groups: QueueGroup[] }>(`/api/enterprises/${enterpriseId}/queue-groups`)
    .then((r) => r.groups);

export const previewQueueGroupMerge = (enterpriseId: number, challengeIds: number[]) =>
  api.post<MergedPanelPreview>(`/api/enterprises/${enterpriseId}/queue-groups/preview-merge`, {
    challengeIds,
  });

export const mergeQueueGroups = (
  enterpriseId: number,
  body: { challengeIds: number[]; displayName: string },
) =>
  api.post<QueueGroup>(`/api/enterprises/${enterpriseId}/queue-groups/merge`, body, {
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });

export const splitQueueGroup = (enterpriseId: number, queueGroupId: number) =>
  api.post<{ groups: QueueGroup[] }>(
    `/api/enterprises/${enterpriseId}/queue-groups/${queueGroupId}/split`,
    {},
    { headers: { "Idempotency-Key": crypto.randomUUID() } },
  );

export const updateQueueGroup = (
  queueGroupId: number,
  body: { displayName?: string; criteria?: Question[] },
) => api.patch<QueueGroup>(`/api/queue/groups/${queueGroupId}`, body);

export const getAssignableRooms = (enterpriseId: number) =>
  api
    .get<{ rooms: AssignableRoom[] }>(`/api/enterprises/${enterpriseId}/assignable-rooms`)
    .then((response) => response.rooms);

export const setQueueGroupRooms = (queueGroupId: number, roomIds: number[]) =>
  api.put<QueueGroup>(
    `/api/queue/groups/${queueGroupId}/rooms`,
    { roomIds },
    { headers: { "Idempotency-Key": crypto.randomUUID() } },
  );

export const moveQueueEntry = (entryId: number, position: number) =>
  api.post(
    `/api/queue/entries/${entryId}/move-to`,
    { position },
    { headers: { "Idempotency-Key": crypto.randomUUID() } },
  );

/** GET /api/queue/me — participant view (H38). */
export interface MyQueueRoom {
  id: number;
  name: string;
  location: string | null;
}

export interface MyQueueEntry {
  entryId: number;
  challengeId: number;
  challengeTitle: string;
  repoId: number;
  repoName: string;
  status: QueueStatus | string;
  position: number | null;
  etaMinutes: number | null;
  calledAt: string | null;
  /** The concrete room the entry was called to; null while still waiting. */
  room: MyQueueRoom | null;
  /** Every room serving this challenge's queue group — the full set a waiting team can be called to. */
  rooms: MyQueueRoom[];
}

// ── reads ────────────────────────────────────────────────────────────────
export const getRoomView = (roomId: number) => api.get<RoomView>(`/api/queue/rooms/${roomId}/view`);
export const getAllRoomViews = () => api.get<RoomView[]>("/api/tv/rooms");
// TV display state, the timetable and the live-screen config live in lib/tv.ts.
export const getChallengeProgress = (challengeId: number) =>
  api.get<ChallengeProgress>(`/api/queue/challenges/${challengeId}/progress`);
export const getRoomPace = (roomId: number) => api.get<RoomPace>(`/api/queue/rooms/${roomId}/pace`);
export const getRoomAssignments = (roomId: number) =>
  api.get<RoomAssignments>(`/api/queue/rooms/${roomId}/assignments`);
/** GET /api/queue/repos/:id/challenges — every challenge queue a repo belongs to (H40). */
export interface RepoChallenge {
  id: number;
  title: string;
  status: QueueStatus | string;
  room_id: number | null;
  room_name: string | null;
  judging_rooms: Array<{ id: number; name: string }>;
}
export const getRepoChallenges = (repoId: number) =>
  api.get<RepoChallenge[]>(`/api/queue/repos/${repoId}/challenges`);
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
export const updateRoomState = (
  roomId: number,
  body: { maxInWaitingArea?: number; desiredMinutesPerTeam?: number },
) => api.patch<RoomQueueState>(`/api/queue/rooms/${roomId}/state`, body);
export const updateQueueSettings = (body: {
  handoffBufferMinutes?: number;
  scheduleStartAt?: string | null;
  scheduleEndAt?: string | null;
  preCallNotificationEtaMinutes?: number;
  requeuePromptDefault?: QueueSettings["requeue_prompt_default"];
}) => api.patch<QueueSettings>("/api/queue/settings", body);
/** Every queue the caller may manage, across enterprises. */
export const listQueueGroups = () =>
  api.get<{ groups: QueueGroup[] }>("/api/queue/groups").then((r) => r.groups);
export const assignRoomQueueGroup = (roomId: number, queueGroupId: number) =>
  api.post(`/api/queue/rooms/${roomId}/queue-group`, { queueGroupId });
export const removeRoomQueueGroup = (roomId: number, queueGroupId: number) =>
  api.delete(`/api/queue/rooms/${roomId}/queue-group/${queueGroupId}`);
export const enqueueAllChallengeQueues = (idempotencyKey?: string) =>
  api.post<{
    challenges: Array<{ challengeId: number; inserted: number; alreadyQueued: number }>;
    inserted: number;
    alreadyQueued: number;
  }>("/api/queue/challenges/enqueue-all", {}, idem(idempotencyKey));

export interface QueueGenerationResult {
  challenges: Array<{
    challengeId: number;
    inserted: number;
    revived: number;
    alreadyQueued: number;
  }>;
  inserted: number;
  revived: number;
  alreadyQueued: number;
}

export const generateQueue = (queueGroupId: number) =>
  api.post<QueueGenerationResult>(
    `/api/queue/groups/${queueGroupId}/generate`,
    {},
    { headers: { "Idempotency-Key": crypto.randomUUID() } },
  );

export const clearQueue = (queueGroupId: number) =>
  api.delete<{ cleared: number }>(`/api/queue/groups/${queueGroupId}/entries`, {
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });

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
  | "move-top"
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

export interface AttemptReviewVersion {
  id: number;
  attempt_id: number;
  author_id: number;
  changed_fields: string[];
  previous: Record<string, unknown>;
  new: Record<string, unknown>;
  created_at: string;
  name: string | null;
  surname: string | null;
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
  blocked_by_room_id: number | null;
  blocked_by_room_name: string | null;
  blocked_by_team_name: string | null;
  blocked_by_status: string | null;
}

export const getReview = (entryId: number) =>
  api.get<AttemptReview>(`/api/queue/entries/${entryId}/review`);
export const saveReview = (entryId: number, body: Record<string, unknown>) =>
  api.patch<AttemptReview>(`/api/queue/entries/${entryId}/review`, body);
export const getReviewVersions = (entryId: number) =>
  api.get<AttemptReviewVersion[]>(`/api/queue/entries/${entryId}/review/versions`);
export const openSession = (entryId: number, roomId?: number) =>
  api.post<JudgingSession>(`/api/queue/entries/${entryId}/session`, { roomId });
export const closeSession = (entryId: number) =>
  api.delete(`/api/queue/entries/${entryId}/session`);
export const getSessions = (entryId: number) =>
  api.get<JudgingSession[]>(`/api/queue/entries/${entryId}/sessions`);
export const searchTeams = (challengeId: number, q: string) =>
  api.get<QueueSearchResult[]>(`/api/queue/challenges/${challengeId}/search`, { query: { q } });

// ── reviews overview detail (H46) ──────────────────────────────────────────
/** The ficha behind a reviews-overview row: project, panel questions, answers. */
export interface ReviewDetail {
  entryId: number;
  status: string;
  calledAt: string | null;
  presentationStartedAt: string | null;
  completedAt: string | null;
  challenge: { id: number; title: TranslatedText; criteria: Question[] };
  room: { id: number; name: string; location: string | null } | null;
  project: {
    id: number;
    name: string;
    description: string;
    githubUrl: string | null;
    devpostUrl: string | null;
    demoUrl: string | null;
    members: Array<{ id: number | null; name: string; email: string | null }>;
  };
  review: {
    status: "draft" | "submitted" | null;
    scores: Record<string, unknown>;
    notes: string | null;
    updatedAt: string | null;
  };
  versions: Array<{ id: number; authorName: string; changedFields: string[]; createdAt: string }>;
}

export const getReviewDetail = (entryId: number) =>
  api.get<ReviewDetail>(`/api/queue/reviews/${entryId}`);
export const saveReviewFromOverview = (entryId: number, body: Record<string, unknown>) =>
  api.patch<AttemptReview>(`/api/queue/reviews/${entryId}`, body);
export const messageReviewTeam = (entryId: number, message: string) =>
  api.post<{ recipients: number }>(`/api/queue/reviews/${entryId}/message`, { message });

/** CSV export URLs (open directly — credentialed download) (H40). */
export const exportUrls = (challengeId: number) => ({
  queue: `/api/queue/challenges/${challengeId}/export/queue.csv`,
  evaluations: `/api/queue/challenges/${challengeId}/export/evaluations.csv`,
});
