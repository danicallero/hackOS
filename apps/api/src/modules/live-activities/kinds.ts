import {
  type AccreditationLiveProps,
  type AttendeeActivityLiveProps,
  accreditationLiveLabels,
  attendeeActivityLiveLabels,
  type DeadlineLiveProps,
  deadlineLiveLabels,
  type JudgingLiveProps,
  judgingLiveLabels,
  LIVE_ACTIVITY_PROPS_VERSION,
} from "@hackos/shared/live-activities";
import type { Language } from "@hackos/shared/locale";
import { config } from "../../config.js";
import { pool, type Queryable } from "../../db/pool.js";

/**
 * Loaders and builders for the attendee, deadline, judging and accreditation
 * Live Activities (#966). Each loader reads its data set once for every
 * candidate user (no per-device queries); the builders are pure, so the read
 * endpoint and the worker render identical props.
 */

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

// ── Attendee activity (H59) ───────────────────────────────────────────────

export interface LiveAttendeeItem {
  id: number;
  title: string;
  titleI18n: Record<string, string>;
  category: string;
  location: string | null;
  audiences: string[];
  startsAt: Date;
  endsAt: Date;
}

/**
 * Opted-in schedule items (`live_activity_audience`) that are live for their
 * audience — shown and published, the same visibility rule as the
 * audience-aware schedule feed (`listScheduleForAudiences`) — and start
 * within `LIVE_ACTIVITY_LEAD_MINUTES` or are still running.
 */
export async function loadLiveAttendeeItems(
  db: Queryable = pool,
  leadMinutes: number = config.LIVE_ACTIVITY_LEAD_MINUTES,
): Promise<LiveAttendeeItem[]> {
  const { rows } = await db.query<{
    id: number;
    title: string;
    title_i18n: Record<string, string> | null;
    type: string | null;
    location: string | null;
    audiences: string[];
    starts_at: Date;
    ends_at: Date;
  }>(
    `SELECT id, title, title_i18n, type, location, audiences, starts_at, ends_at
       FROM schedule
      WHERE live_activity_audience
        AND visibility = 'shown'
        AND (publish_at IS NULL OR publish_at <= now())
        AND cardinality(audiences) > 0
        AND starts_at <= now() + make_interval(mins => $1)
        AND now() < ends_at
      ORDER BY starts_at ASC, id ASC`,
    [leadMinutes],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    titleI18n: r.title_i18n ?? {},
    category: r.type ?? "general",
    location: r.location,
    audiences: r.audiences,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
  }));
}

export function scheduleDeepLink(scheduleId: number): string {
  return `${config.MOBILE_APP_SCHEME}://schedule/${scheduleId}`;
}

export function buildAttendeeActivityLiveProps(
  item: LiveAttendeeItem,
  language: Language,
  now: Date,
): AttendeeActivityLiveProps {
  return {
    v: LIVE_ACTIVITY_PROPS_VERSION,
    kind: "attendee_activity",
    phase: now < item.startsAt ? "upcoming" : "live",
    scheduleId: item.id,
    name: item.titleI18n[language] || item.titleI18n.en || item.title,
    category: item.category,
    location: item.location,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    url: scheduleDeepLink(item.id),
    labels: attendeeActivityLiveLabels(language),
    updatedAt: now.toISOString(),
  };
}

// ── Submission deadline (H19, H20) ─────────────────────────────────────────

/** Unsubmitted teams get one alerting update when this little time is left. */
export const DEADLINE_CLOSING_MINUTES = 15;

export interface DeadlineWindow {
  startsAt: Date | null;
  endsAt: Date;
}

/**
 * Submissions close at `event_config.hacking_ends_at` — the same instant
 * `projects/lifecycle.ts` enforces ("The submission deadline has passed")
 * and Devpost imports lock at. The activity exists from
 * `LIVE_ACTIVITY_DEADLINE_LEAD_MINUTES` before it until it passes.
 */
export async function readDeadlineWindow(
  db: Queryable = pool,
  leadMinutes: number = config.LIVE_ACTIVITY_DEADLINE_LEAD_MINUTES,
): Promise<DeadlineWindow | null> {
  const { rows } = await db.query<{ hacking_starts_at: Date | null; hacking_ends_at: Date }>(
    `SELECT hacking_starts_at, hacking_ends_at
       FROM event_config
      WHERE id = 1 AND hacking_ends_at IS NOT NULL
        AND now() < hacking_ends_at
        AND hacking_ends_at <= now() + make_interval(mins => $1)`,
    [leadMinutes],
  );
  const row = rows[0];
  return row ? { startsAt: row.hacking_starts_at, endsAt: row.hacking_ends_at } : null;
}

export interface SubmissionFact {
  submission: "submitted" | "draft" | null;
  projectName: string | null;
}

/**
 * Each user's hackOS project status: every project or work group they are an
 * active member of (the same three membership sources as
 * `isActiveProjectMember`, H54 fixture boundary included), submitted only
 * when all of them are. No project in hackOS → `null` (e.g. a Devpost team
 * not imported yet): unknown, never "not submitted".
 */
export async function loadSubmissionFacts(
  userIds: number[],
  db: Queryable = pool,
): Promise<Map<number, SubmissionFact>> {
  const result = new Map<number, SubmissionFact>();
  if (userIds.length === 0) return result;
  const { rows } = await db.query<{ user_id: number; name: string; status: string }>(
    `SELECT s.user_id, r.name, r.submission_status AS status
       FROM submissions s
       JOIN repos r ON r.id = s.repo_id AND r.reconciled_into_repo_id IS NULL
       JOIN users u ON u.id = s.user_id AND u.is_test_account = r.is_test_account
      WHERE s.user_id = ANY($1::int[]) AND s.status = 'active'
     UNION
     SELECT dp.user_id, r.name, r.submission_status
       FROM devpost_participants dp
       JOIN repos r ON r.id = dp.repo_id AND r.reconciled_into_repo_id IS NULL
       JOIN users u ON u.id = dp.user_id AND u.is_test_account = r.is_test_account
      WHERE dp.user_id = ANY($1::int[])
     UNION
     SELECT m.user_id, COALESCE(r.name, g.name),
            CASE WHEN g.linked_repo_id IS NULL THEN 'draft' ELSE r.submission_status END
       FROM planned_work_group_members m
       JOIN planned_work_groups g ON g.id = m.group_id
       LEFT JOIN repos r ON r.id = g.linked_repo_id
      WHERE m.user_id = ANY($1::int[]) AND m.status = 'active'
      ORDER BY 1, 2`,
    [userIds],
  );
  const byUser = new Map<number, { name: string; status: string }[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push({ name: row.name, status: row.status });
    byUser.set(row.user_id, list);
  }
  for (const [userId, projects] of byUser) {
    const open = projects.find((p) => p.status !== "submitted");
    result.set(userId, {
      submission: open ? "draft" : "submitted",
      projectName: (open ?? projects[0])?.name ?? null,
    });
  }
  return result;
}

export function projectDeepLink(): string {
  return `${config.MOBILE_APP_SCHEME}://project`;
}

export function buildDeadlineLiveProps(
  window: DeadlineWindow,
  fact: SubmissionFact | undefined,
  language: Language,
  now: Date,
): DeadlineLiveProps {
  const submission = fact?.submission ?? null;
  const closing = window.endsAt.getTime() - now.getTime() <= DEADLINE_CLOSING_MINUTES * 60_000;
  return {
    v: LIVE_ACTIVITY_PROPS_VERSION,
    kind: "deadline",
    phase:
      submission === "submitted"
        ? "submitted"
        : closing && submission === "draft"
          ? "closing"
          : "open",
    startsAt: iso(window.startsAt),
    endsAt: window.endsAt.toISOString(),
    submission,
    projectName: fact?.projectName ?? null,
    url: projectDeepLink(),
    labels: deadlineLiveLabels(language),
    updatedAt: now.toISOString(),
  };
}

// ── Judging room (H29-H36) ─────────────────────────────────────────────────

/**
 * Rooms each user judges in, by the association the room view grants
 * (`judgesRoomEnterprise` in queue/contextual-access.ts): the room serves a
 * queue group of an enterprise the user judges for (roster or sponsor rep).
 * A `judge:panel` holder without that association has no room of their own.
 */
export async function loadJudgeRooms(
  userIds: number[],
  db: Queryable = pool,
): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  if (userIds.length === 0) return result;
  const { rows } = await db.query<{ user_id: number; room_id: number }>(
    `SELECT DISTINCT j.user_id, rqg.room_id
       FROM room_queue_groups rqg
       JOIN queue_groups qg ON qg.id = rqg.queue_group_id
       JOIN (SELECT user_id, enterprise_id FROM enterprise_judges
             UNION
             SELECT user_id, enterprise_id FROM sponsors WHERE user_id IS NOT NULL) j
         ON j.enterprise_id = qg.enterprise_id
      WHERE j.user_id = ANY($1::int[])
      ORDER BY j.user_id, rqg.room_id`,
    [userIds],
  );
  for (const row of rows) {
    const list = result.get(row.user_id) ?? [];
    list.push(row.room_id);
    result.set(row.user_id, list);
  }
  return result;
}

interface RoomEntry {
  id: number;
  status: "called" | "in_room" | "presenting";
  name: string;
  calledAt: Date | null;
  enteredAt: Date | null;
  presentationStartedAt: Date | null;
  presentationPausedAt: Date | null;
  presentationPausedSeconds: number;
  presentationSeconds: number | null;
}

export interface LiveJudgingRoom {
  id: number;
  name: string;
  location: string | null;
  queueTitle: string | null;
  paused: boolean;
  /** H54: whether the room's queue is a review-fixture one (null = mixed or none). */
  fixture: boolean | null;
  entries: RoomEntry[];
  waiting: number;
}

/**
 * State of `roomIds` in three queries. Entries and counts only include
 * repo/challenge pairs on one side of the H54 fixture boundary, and a room
 * is labeled with its queue's side so viewers only get rooms of their own.
 */
export async function loadJudgingRooms(
  roomIds: number[],
  db: Queryable = pool,
): Promise<Map<number, LiveJudgingRoom>> {
  const result = new Map<number, LiveJudgingRoom>();
  if (roomIds.length === 0) return result;
  const { rows: rooms } = await db.query<{
    id: number;
    name: string;
    location: string | null;
    paused: boolean;
    queue_title: string | null;
    all_fixture: boolean | null;
    any_fixture: boolean | null;
  }>(
    `SELECT r.id, r.name, r.location, COALESCE(rqs.is_paused, true) AS paused,
            qg.display_name AS queue_title,
            bool_and(c.is_test_account) AS all_fixture,
            bool_or(c.is_test_account) AS any_fixture
       FROM rooms r
       LEFT JOIN room_queue_state rqs ON rqs.room_id = r.id
       LEFT JOIN room_queue_groups rqg ON rqg.room_id = r.id
       LEFT JOIN queue_groups qg ON qg.id = rqg.queue_group_id
       LEFT JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
       LEFT JOIN challenges c ON c.id = qgc.challenge_id
      WHERE r.id = ANY($1::int[])
      GROUP BY r.id, r.name, r.location, rqs.is_paused, qg.display_name`,
    [roomIds],
  );
  for (const room of rooms) {
    result.set(room.id, {
      id: room.id,
      name: room.name,
      location: room.location,
      queueTitle: room.queue_title,
      paused: room.paused,
      fixture:
        room.all_fixture === null || room.all_fixture !== room.any_fixture
          ? null
          : room.all_fixture,
      entries: [],
      waiting: 0,
    });
  }
  const { rows: entries } = await db.query<{
    id: number;
    room_id: number;
    status: RoomEntry["status"];
    name: string;
    called_at: Date | null;
    room_entered_at: Date | null;
    presentation_started_at: Date | null;
    presentation_paused_at: Date | null;
    presentation_paused_seconds: number;
    presentation_seconds: number | null;
    fixture: boolean;
  }>(
    `SELECT qe.id, qe.assigned_room_id AS room_id, qe.status, rp.name, qe.called_at,
            qe.room_entered_at, qe.presentation_started_at, qe.presentation_paused_at,
            qe.presentation_paused_seconds,
            COALESCE(qe.presentation_total_seconds, c.max_presentation_seconds) AS presentation_seconds,
            rp.is_test_account AS fixture
       FROM queue_entries qe
       JOIN repos rp ON rp.id = qe.repo_id
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = rp.is_test_account
      WHERE qe.assigned_room_id = ANY($1::int[])
        AND qe.status IN ('called', 'in_room', 'presenting')
      ORDER BY qe.called_at ASC NULLS LAST, qe.id ASC`,
    [roomIds],
  );
  for (const row of entries) {
    const room = result.get(row.room_id);
    if (!room || room.fixture !== row.fixture) continue;
    room.entries.push({
      id: row.id,
      status: row.status,
      name: row.name,
      calledAt: row.called_at,
      enteredAt: row.room_entered_at,
      presentationStartedAt: row.presentation_started_at,
      presentationPausedAt: row.presentation_paused_at,
      presentationPausedSeconds: Number(row.presentation_paused_seconds) || 0,
      presentationSeconds: row.presentation_seconds,
    });
  }
  const { rows: waiting } = await db.query<{ room_id: number; fixture: boolean; n: number }>(
    `SELECT rqg.room_id, rp.is_test_account AS fixture, count(*)::int AS n
       FROM room_queue_groups rqg
       JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
       JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id AND qe.status = 'waiting'
       JOIN repos rp ON rp.id = qe.repo_id
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = rp.is_test_account
      WHERE rqg.room_id = ANY($1::int[])
      GROUP BY rqg.room_id, rp.is_test_account`,
    [roomIds],
  );
  for (const row of waiting) {
    const room = result.get(row.room_id);
    if (room && room.fixture === row.fixture) room.waiting = row.n;
  }
  return result;
}

export function judgingDeepLink(roomId: number): string {
  return `${config.MOBILE_APP_SCHEME}://judging?room=${roomId}`;
}

/**
 * The judge's room, or null when there is nothing to follow: a paused room
 * (H35) with nobody inside or called. Called teams come first by call time;
 * the pitch timer travels as instants so devices tick it locally.
 */
export function buildJudgingLiveProps(
  room: LiveJudgingRoom,
  language: Language,
  now: Date,
): JudgingLiveProps | null {
  const current = room.entries.find((e) => e.status !== "called") ?? null;
  const called = room.entries.filter((e) => e.status === "called");
  if (room.paused && !current && called.length === 0) return null;
  const next = called[0] ?? null;
  return {
    v: LIVE_ACTIVITY_PROPS_VERSION,
    kind: "judging",
    phase: current
      ? current.status === "presenting"
        ? "presenting"
        : "in_room"
      : next
        ? "called"
        : "idle",
    roomId: room.id,
    roomName: room.name,
    roomLocation: room.location,
    queueTitle: room.queueTitle,
    roomPaused: room.paused,
    current: current
      ? {
          entryId: current.id,
          name: current.name,
          status: current.status as "in_room" | "presenting",
          enteredAt: iso(current.enteredAt),
          presentationStartedAt: iso(current.presentationStartedAt),
          presentationPausedAt: iso(current.presentationPausedAt),
          presentationPausedSeconds: Math.round(current.presentationPausedSeconds),
          presentationSeconds: current.presentationSeconds,
        }
      : null,
    next: next ? { entryId: next.id, name: next.name, calledAt: iso(next.calledAt) } : null,
    calledCount: called.length,
    waitingCount: room.waiting,
    url: judgingDeepLink(room.id),
    labels: judgingLiveLabels(language),
    updatedAt: now.toISOString(),
  };
}

// ── Accreditation desk (H22, H24, H27) ─────────────────────────────────────

export const ACCREDITATION_RECENT_MINUTES = 10;

/**
 * Decision: event_config has no check-in window, so the desk's window is
 * derived. It opens `LIVE_ACTIVITY_ACCREDITATION_LEAD_MINUTES` before the
 * event starts (`event_starts_at`, else `hacking_starts_at`) and closes
 * `LIVE_ACTIVITY_ACCREDITATION_TAIL_MINUTES` after hacking starts (else the
 * event start): the arrival rush. Late arrivals are still scanned in the app.
 */
export async function readAccreditationWindow(
  db: Queryable = pool,
  leadMinutes: number = config.LIVE_ACTIVITY_ACCREDITATION_LEAD_MINUTES,
  tailMinutes: number = config.LIVE_ACTIVITY_ACCREDITATION_TAIL_MINUTES,
): Promise<{ endsAt: Date } | null> {
  const { rows } = await db.query<{ ends_at: Date }>(
    `SELECT ends_at FROM (
       SELECT COALESCE(event_starts_at, hacking_starts_at) - make_interval(mins => $1) AS starts_at,
              COALESCE(hacking_starts_at, event_starts_at) + make_interval(mins => $2) AS ends_at
         FROM event_config WHERE id = 1
     ) w
     WHERE starts_at <= now() AND now() < ends_at`,
    [leadMinutes, tailMinutes],
  );
  return rows[0] ? { endsAt: rows[0].ends_at } : null;
}

export interface AccreditationCounts {
  eligible: number;
  accredited: number;
  recentArrivals: number;
}

/**
 * The scanner home tile's totals (`scannerRoleStats` in logistics/stats.ts):
 * eligible = active accounts with event access, accredited = active accounts
 * with a badge; plus badges assigned in the last 10 minutes. Split by the H54
 * fixture marker so each operator side counts only its own subjects.
 */
export async function loadAccreditationCounts(
  db: Queryable = pool,
): Promise<Map<boolean, AccreditationCounts>> {
  const { rows } = await db.query<{
    is_test_account: boolean;
    eligible: number;
    accredited: number;
    recent: number;
  }>(
    `SELECT u.is_test_account,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_event_access uea WHERE uea.user_id = u.id))::int AS eligible,
            count(*) FILTER (WHERE u.badge_id IS NOT NULL)::int AS accredited,
            count(*) FILTER (WHERE u.badge_id IS NOT NULL
                               AND u.badge_assigned_at >= now() - make_interval(mins => $1))::int AS recent
       FROM users u
      WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
      GROUP BY u.is_test_account`,
    [ACCREDITATION_RECENT_MINUTES],
  );
  const result = new Map<boolean, AccreditationCounts>();
  for (const row of rows) {
    result.set(row.is_test_account, {
      eligible: row.eligible,
      accredited: row.accredited,
      recentArrivals: row.recent,
    });
  }
  return result;
}

export function accreditationDeepLink(): string {
  return `${config.MOBILE_APP_SCHEME}://scan`;
}

export function buildAccreditationLiveProps(
  window: { endsAt: Date },
  counts: AccreditationCounts | undefined,
  inside: number | null,
  language: Language,
  now: Date,
): AccreditationLiveProps {
  const link = accreditationDeepLink();
  return {
    v: LIVE_ACTIVITY_PROPS_VERSION,
    kind: "accreditation",
    phase: "live",
    accredited: counts?.accredited ?? 0,
    eligible: counts?.eligible ?? 0,
    inside,
    recentArrivals: counts?.recentArrivals ?? 0,
    endsAt: window.endsAt.toISOString(),
    scanUrl: link,
    url: link,
    labels: accreditationLiveLabels(language),
    updatedAt: now.toISOString(),
  };
}
