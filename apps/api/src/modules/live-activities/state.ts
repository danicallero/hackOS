import { createHash } from "node:crypto";
import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  type ActivityLiveProps,
  activityLiveLabels,
  LIVE_ACTIVITY_PROPS_VERSION,
  type LiveActivityProps,
  type MyLiveActivities,
  type QueueLiveProps,
  queueLiveLabels,
} from "@hackos/shared/live-activities";
import type { Language } from "@hackos/shared/locale";
import { config } from "../../config.js";
import { pool, type Queryable } from "../../db/pool.js";
import { hasMyQueueItems, myQueueStatus } from "../queue/reads.js";

/**
 * Live Activity state builders (#966; H38 queue, H25/H26 staff activities).
 * The single source of truth for what a Live Activity shows: the read
 * endpoint (`GET /api/me/live-activities`, used by the app while in the
 * foreground) and the push worker both call these, so a remote update and a
 * local refresh can never disagree.
 */

type QueueStatus = Awaited<ReturnType<typeof myQueueStatus>>[number];

/** Entry states the queue Live Activity tracks; `presenting`/`completed` are over for the participant. */
const LIVE_QUEUE_STATUSES = new Set(["waiting", "called", "in_room"]);

export function queueDeepLink(): string {
  return `${config.MOBILE_APP_SCHEME}://queue`;
}

/** Tap and the Scan action both open the scanner already bound to the activity (H25, H26). */
export function activityScanDeepLink(activityId: number): string {
  return `${config.MOBILE_APP_SCHEME}://scan?activity=${activityId}`;
}

export interface JudgingWindow {
  open: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * H38/#966: the queue Live Activity exists only inside the configured judging
 * window (queue_settings.schedule_start_at/schedule_end_at, owned by the
 * queue module). Unlike the pump, an unset start does not count as open: a
 * system-level surface must not appear before organizers schedule judging.
 */
export async function readJudgingWindow(db: Queryable = pool): Promise<JudgingWindow> {
  const { rows } = await db.query<{
    schedule_start_at: Date | null;
    schedule_end_at: Date | null;
    open: boolean;
  }>(
    `SELECT schedule_start_at, schedule_end_at,
            COALESCE(schedule_start_at <= now()
                     AND (schedule_end_at IS NULL OR now() < schedule_end_at), false) AS open
       FROM queue_settings WHERE id = 1`,
  );
  const row = rows[0];
  return {
    open: row?.open ?? false,
    startsAt: row?.schedule_start_at ?? null,
    endsAt: row?.schedule_end_at ?? null,
  };
}

/** Status rows for a participant, or [] when they have no queue entries at all (cheap pre-check). */
export async function participantQueueStatuses(userId: number): Promise<QueueStatus[]> {
  if (!(await hasMyQueueItems(userId))) return [];
  return myQueueStatus(userId);
}

function calledRank(status: QueueStatus): number {
  // The room the team is already in outranks a call elsewhere; then the
  // earliest call, which is the one the team is expected at first.
  return status.status === "in_room" ? 0 : 1;
}

/**
 * `called_at` arrives from pg as a Date (typed as string upstream). Compare
 * instants, never `String(date)` ("Sun Oct 11 …"), which orders by weekday.
 */
function calledAtMs(status: QueueStatus): number {
  if (status.calledAt == null) return Number.POSITIVE_INFINITY;
  const ms = new Date(status.calledAt as unknown as string | Date).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * H38: the participant's *nearest* queue, from `myQueueStatus` rows. A
 * `called`/`in_room` entry beats any waiting one; among waiting entries the
 * smallest ETA wins (then position). The room is shown only once called
 * (H29); position and ETA only while waiting.
 */
export function selectQueueLiveProps(
  statuses: QueueStatus[],
  language: Language,
  now: Date,
): QueueLiveProps | null {
  const live = statuses.filter((s) => LIVE_QUEUE_STATUSES.has(s.status));
  if (live.length === 0) return null;

  const called = live
    .filter((s) => s.status !== "waiting")
    .sort(
      (a, b) =>
        calledRank(a) - calledRank(b) || calledAtMs(a) - calledAtMs(b) || a.entryId - b.entryId,
    );
  const waiting = live
    .filter((s) => s.status === "waiting")
    .sort(
      (a, b) =>
        (a.etaMinutes ?? Number.POSITIVE_INFINITY) - (b.etaMinutes ?? Number.POSITIVE_INFINITY) ||
        (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY) ||
        a.entryId - b.entryId,
    );
  const nearest = called[0] ?? waiting[0];
  if (!nearest) return null;

  const isCalled = nearest.status !== "waiting";
  const otherQueues = live.length - 1;
  return {
    v: LIVE_ACTIVITY_PROPS_VERSION,
    kind: "queue",
    phase: nearest.status as QueueLiveProps["phase"],
    entryId: nearest.entryId,
    challengeTitle: nearest.challengeTitle,
    position: isCalled ? null : nearest.position,
    etaMinutes: isCalled ? null : nearest.etaMinutes,
    roomName: isCalled ? (nearest.room?.name ?? null) : null,
    roomLocation: isCalled ? (nearest.room?.location ?? null) : null,
    otherQueues,
    url: queueDeepLink(),
    labels: queueLiveLabels(language, otherQueues),
    updatedAt: now.toISOString(),
  };
}

export interface LiveScannableActivity {
  id: number;
  name: string;
  nameI18n: Record<string, string>;
  category: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
}

/**
 * H25/H26: scannable activities (meal kinds are always scannable; others
 * need `requires_scan`, the same rule as the scanner's activity list in
 * logistics/stats.ts) whose linked schedule row starts within the lead time
 * or is still running.
 */
export async function loadLiveScannableActivities(
  db: Queryable = pool,
  leadMinutes: number = config.LIVE_ACTIVITY_LEAD_MINUTES,
): Promise<LiveScannableActivity[]> {
  const { rows } = await db.query<{
    id: number;
    name: string;
    name_i18n: Record<string, string> | null;
    category: string;
    location: string | null;
    starts_at: Date;
    ends_at: Date;
  }>(
    `SELECT a.id, a.name, a.name_i18n, a.category, s.location, s.starts_at, s.ends_at
       FROM activities a
       JOIN schedule s ON s.id = a.schedule_id
      WHERE (a.category = ANY($1::text[]) OR a.requires_scan = true)
        AND s.starts_at <= now() + make_interval(mins => $2)
        AND now() < s.ends_at
      ORDER BY s.starts_at ASC, a.id ASC`,
    [[...MEAL_ACTIVITY_KINDS], leadMinutes],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameI18n: r.name_i18n ?? {},
    category: r.category,
    location: r.location,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
  }));
}

/**
 * Distinct people registered per activity, split by the H54 fixture marker so
 * a synthetic operator only ever counts synthetic subjects and a real one
 * only real subjects (same isolation as logistics/stats.ts).
 */
export async function loadScannedCounts(
  activityIds: number[],
  db: Queryable = pool,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (activityIds.length === 0) return counts;
  const { rows } = await db.query<{ activity_id: number; is_test_account: boolean; n: number }>(
    `SELECT al.activity_id, u.is_test_account, count(DISTINCT u.id)::int AS n
       FROM activity_logs al
       JOIN users u ON u.id = al.user_id
      WHERE al.activity_id = ANY($1::int[])
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
      GROUP BY al.activity_id, u.is_test_account`,
    [activityIds],
  );
  for (const row of rows) counts.set(scannedKey(row.activity_id, row.is_test_account), row.n);
  return counts;
}

export function scannedKey(activityId: number, testAccount: boolean): string {
  return `${activityId}:${testAccount ? 1 : 0}`;
}

/** Of `userIds`, those currently holding ACTIVITY_SCAN (or `*`), resolved in one query (H8). */
export async function usersWithActivityScan(
  userIds: number[],
  db: Queryable = pool,
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const { rows } = await db.query<{ user_id: number }>(
    `SELECT DISTINCT uec.user_id
       FROM user_effective_capabilities uec
      WHERE uec.user_id = ANY($1::int[]) AND uec.capability = ANY($2::text[])`,
    [userIds, [CAPABILITIES.ACTIVITY_SCAN, CAPABILITIES.ADMIN_ALL]],
  );
  return new Set(rows.map((r) => r.user_id));
}

export function buildActivityLiveProps(
  activity: LiveScannableActivity,
  scanned: number,
  language: Language,
  now: Date,
): ActivityLiveProps {
  const link = activityScanDeepLink(activity.id);
  return {
    v: LIVE_ACTIVITY_PROPS_VERSION,
    kind: "activity",
    phase: now < activity.startsAt ? "upcoming" : "live",
    activityId: activity.id,
    // Same fallback chain as the scanner list: requested language, English,
    // then the activity's own (primary-language) name.
    name: activity.nameI18n[language] || activity.nameI18n.en || activity.name,
    category: activity.category,
    location: activity.location,
    startsAt: activity.startsAt.toISOString(),
    endsAt: activity.endsAt.toISOString(),
    scanned,
    scanUrl: link,
    url: link,
    labels: activityLiveLabels(language),
    updatedAt: now.toISOString(),
  };
}

/**
 * Stable hash of what a Live Activity renders — everything except
 * `updatedAt` — so the worker only pushes when the visible state changes.
 */
export function liveStateHash(props: LiveActivityProps): string {
  const { updatedAt: _ignored, ...rest } = props;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 32);
}

/** `GET /api/me/live-activities` for one user (the app's foreground source). */
export async function myLiveActivities(
  userId: number,
  language: Language,
  canScanActivities: boolean,
): Promise<MyLiveActivities> {
  const now = new Date();
  const window = await readJudgingWindow();
  const queue = window.open
    ? selectQueueLiveProps(await participantQueueStatuses(userId), language, now)
    : null;

  let activities: ActivityLiveProps[] = [];
  if (canScanActivities) {
    const rows = await loadLiveScannableActivities();
    if (rows.length > 0) {
      const { rows: userRows } = await pool.query<{ is_test_account: boolean }>(
        `SELECT is_test_account FROM users WHERE id = $1`,
        [userId],
      );
      const testAccount = userRows[0]?.is_test_account === true;
      const counts = await loadScannedCounts(rows.map((r) => r.id));
      activities = rows.map((row) =>
        buildActivityLiveProps(
          row,
          counts.get(scannedKey(row.id, testAccount)) ?? 0,
          language,
          now,
        ),
      );
    }
  }
  return { judgingWindowOpen: window.open, queue, activities };
}
