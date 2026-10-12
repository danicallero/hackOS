import {
  type AccreditationLiveProps,
  type AttendeeActivityLiveProps,
  accreditationLiveLabels,
  attendeeActivityLiveLabels,
  countdownFlags,
  type DeadlineLiveProps,
  deadlineLiveLabels,
  LIVE_ACTIVITY_PROPS_VERSION,
} from "@hackos/shared/live-activities";
import type { Language } from "@hackos/shared/locale";
import { config } from "../../config.js";
import { pool, type Queryable } from "../../db/pool.js";
import { scannerSubjectScope } from "../logistics/review-fixture-scope.js";
import { readLeadMinutes } from "./settings.js";

/**
 * Loaders and builders for the attendee, deadline and accreditation Live
 * Activities (#966). Each loader reads its data set once for every
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
 * within the configured lead time (`readLeadMinutes`) or are still running.
 */
export async function loadLiveAttendeeItems(
  db: Queryable = pool,
  leadMinutes?: number,
): Promise<LiveAttendeeItem[]> {
  const lead = leadMinutes ?? (await readLeadMinutes(db));
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
    [lead],
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
    // #966: precision flags trigger one re-render at each native timer format boundary.
    ...countdownFlags(now < item.startsAt ? item.startsAt : item.endsAt, now),
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
 * and Devpost imports lock at. Decision (H19): the activity runs for the
 * whole hacking period, from `hacking_starts_at` until the deadline passes;
 * only without a start does it fall back to
 * `LIVE_ACTIVITY_DEADLINE_LEAD_MINUTES` before the deadline.
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
        AND COALESCE(hacking_starts_at, hacking_ends_at - make_interval(mins => $1)) <= now()`,
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
    ...countdownFlags(window.endsAt, now),
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
 * with a badge; plus badges assigned in the last 10 minutes. Keyed by the
 * operator's H54 side, over the same people the scanner roster (the people
 * finder) shows that side (`scannerSubjectScope`). Also the staff activity
 * denominator (`accredited`, H24/H25).
 */
export async function loadAccreditationCounts(
  db: Queryable = pool,
): Promise<Map<boolean, AccreditationCounts>> {
  const result = new Map<boolean, AccreditationCounts>();
  for (const fixtureOnly of [false, true]) {
    const { rows } = await db.query<{ eligible: number; accredited: number; recent: number }>(
      `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_event_access uea WHERE uea.user_id = u.id))::int AS eligible,
              count(*) FILTER (WHERE u.badge_id IS NOT NULL)::int AS accredited,
              count(*) FILTER (WHERE u.badge_id IS NOT NULL
                                 AND u.badge_assigned_at >= now() - make_interval(mins => $1))::int AS recent
         FROM users u
        WHERE u.account_state = 'active' AND u.anonymized_at IS NULL${scannerSubjectScope(fixtureOnly)}`,
      [ACCREDITATION_RECENT_MINUTES],
    );
    const row = rows[0]!;
    result.set(fixtureOnly, {
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
