import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
  type AccreditationLiveProps,
  type ActivityLiveProps,
  type AttendeeActivityLiveProps,
  activityLiveActivitySubject,
  attendeeActivityLiveActivitySubject,
  DEADLINE_LIVE_ACTIVITY_SUBJECT,
  type DeadlineLiveProps,
  LIVE_ACTIVITY_CONFIG_KINDS,
  type LiveActivityConfigKind,
  type LiveActivityKind,
  type LiveActivityProps,
  type MyLiveActivities,
  QUEUE_LIVE_ACTIVITY_SUBJECT,
  type QueueLiveProps,
} from "@hackos/shared/live-activities";
import type { Language } from "@hackos/shared/locale";
import { pool, type Queryable } from "../../db/pool.js";
import { occupancyEstimate } from "../logistics/presence.js";
import { attendeeScheduleAudiencesForUsers } from "../logistics/schedule.js";
import {
  type AccreditationCounts,
  buildAccreditationLiveProps,
  buildAttendeeActivityLiveProps,
  buildDeadlineLiveProps,
  type DeadlineWindow,
  type LiveAttendeeItem,
  loadAccreditationCounts,
  loadLiveAttendeeItems,
  loadSubmissionFacts,
  readAccreditationWindow,
  readDeadlineWindow,
  type SubmissionFact,
} from "./kinds.js";
import {
  buildActivityLiveProps,
  type JudgingWindow,
  type LiveScannableActivity,
  loadLiveScannableActivities,
  loadScannedCounts,
  participantQueueStatuses,
  readJudgingWindow,
  scannedKey,
  selectQueueLiveProps,
} from "./state.js";

/**
 * Which Live Activities a user should have, and which of them a device
 * shows (#966). Shared by `GET /api/me/live-activities` and the push worker:
 *
 * 1. `loadLiveActivityContext` reads every data set once for all candidate
 *    users (cheap pre-checks first: a data set is read only when some user
 *    may receive that kind and its window is open).
 * 2. `candidatesFor` applies the gates — kind enabled, the user holds one of
 *    its configured roles, and the kind's intrinsic capability or data — and
 *    returns the user's candidates in kind-priority order.
 * 3. `selectForDevice` keeps at most `maxConcurrent` of them per device.
 */

type QueueStatus = Awaited<ReturnType<typeof participantQueueStatuses>>[number];

export interface Candidate {
  kind: LiveActivityKind;
  subject: string;
  props: LiveActivityProps;
  /** Kind priority from the configuration (0 = highest). */
  priority: number;
}

interface UserFacts {
  isTestAccount: boolean;
  kinds: Set<LiveActivityConfigKind>;
  capabilities: Set<string>;
  eventAccess: boolean;
}

export interface LiveActivityContext {
  now: Date;
  maxConcurrent: number;
  priority: Map<LiveActivityConfigKind, number>;
  users: Map<number, UserFacts>;
  judgingWindow: JudgingWindow;
  queueStatuses: Map<number, QueueStatus[]>;
  activities: LiveScannableActivity[];
  scannedCounts: Map<string, number>;
  attendeeItems: LiveAttendeeItem[];
  audiences: Map<number, Set<string>>;
  deadline: DeadlineWindow | null;
  submissions: Map<number, SubmissionFact>;
  accreditation: { endsAt: Date } | null;
  accreditationCounts: Map<boolean, AccreditationCounts>;
  inside: number | null;
}

const GATE_CAPABILITIES = [
  CAPABILITIES.ACTIVITY_SCAN,
  CAPABILITIES.ACCREDIT_SCAN,
  CAPABILITIES.QUEUE_STATUS,
  CAPABILITIES.ADMIN_ALL,
];

function hasCapability(user: UserFacts, capability: string): boolean {
  return user.capabilities.has(capability) || user.capabilities.has(CAPABILITIES.ADMIN_ALL);
}

/** Users (of `userIds`) for whom `kind` is enabled and role-allowed. */
function usersAllowed(
  users: Map<number, UserFacts>,
  kind: LiveActivityConfigKind,
  extra: (user: UserFacts) => boolean = () => true,
): number[] {
  return [...users].filter(([, user]) => user.kinds.has(kind) && extra(user)).map(([id]) => id);
}

export async function loadLiveActivityContext(
  userIds: number[],
  now: Date,
  db: Queryable = pool,
): Promise<LiveActivityContext> {
  const { rows: settingsRows } = await db.query<{ max_concurrent: number }>(
    `SELECT max_concurrent FROM live_activity_settings WHERE id = 1`,
  );
  const { rows: kindRows } = await db.query<{ kind: LiveActivityConfigKind; priority: number }>(
    `SELECT kind, priority FROM live_activity_kind_settings ORDER BY priority, kind`,
  );
  const priority = new Map<LiveActivityConfigKind, number>();
  for (const [index, row] of kindRows.entries()) priority.set(row.kind, index);
  for (const [index, kind] of LIVE_ACTIVITY_CONFIG_KINDS.entries()) {
    if (!priority.has(kind)) priority.set(kind, 1_000 + index);
  }

  const users = new Map<number, UserFacts>();
  if (userIds.length > 0) {
    const { rows } = await db.query<{
      id: number;
      is_test_account: boolean;
      kinds: LiveActivityConfigKind[] | null;
      capabilities: string[] | null;
      event_access: boolean;
    }>(
      `SELECT u.id, u.is_test_account,
              (SELECT array_agg(DISTINCT kr.kind)
                 FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
                 JOIN live_activity_kind_roles kr ON kr.role_id = r.id
                 JOIN live_activity_kind_settings ks ON ks.kind = kr.kind AND ks.enabled
                WHERE ur.user_id = u.id) AS kinds,
              (SELECT array_agg(uec.capability)
                 FROM user_effective_capabilities uec
                WHERE uec.user_id = u.id AND uec.capability = ANY($2::text[])) AS capabilities,
              EXISTS (SELECT 1 FROM user_event_access uea WHERE uea.user_id = u.id) AS event_access
         FROM users u
        WHERE u.id = ANY($1::int[]) AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
      [userIds, GATE_CAPABILITIES],
    );
    for (const row of rows) {
      users.set(row.id, {
        isTestAccount: row.is_test_account,
        kinds: new Set(row.kinds ?? []),
        capabilities: new Set(row.capabilities ?? []),
        eventAccess: row.event_access,
      });
    }
  }

  const ctx: LiveActivityContext = {
    now,
    maxConcurrent: settingsRows[0]?.max_concurrent ?? 2,
    priority,
    users,
    judgingWindow: { open: false, startsAt: null, endsAt: null },
    queueStatuses: new Map(),
    activities: [],
    scannedCounts: new Map(),
    attendeeItems: [],
    audiences: new Map(),
    deadline: null,
    submissions: new Map(),
    accreditation: null,
    accreditationCounts: new Map(),
    inside: null,
  };
  if (users.size === 0) return ctx;

  let occupancy: Promise<number> | undefined;
  const presentCount = () => {
    occupancy ??= occupancyEstimate().then((o) => o.presentCount);
    return occupancy;
  };
  // Staff activities (denominator) and the desk share one read per tick.
  let accreditation: Promise<Map<boolean, AccreditationCounts>> | undefined;
  const accreditationCounts = () => {
    accreditation ??= loadAccreditationCounts(db);
    return accreditation;
  };

  // Queue (H38): only inside the judging window.
  const queueUsers = usersAllowed(users, "queue");
  ctx.judgingWindow = await readJudgingWindow(db);
  if (ctx.judgingWindow.open) {
    // Bounded: only these users, and myQueueStatus only for those with
    // queue entries (participantQueueStatuses pre-checks).
    for (const userId of queueUsers) {
      ctx.queueStatuses.set(userId, await participantQueueStatuses(userId));
    }
  }

  // Staff meals and activities (H25, H26).
  const scanners = usersAllowed(users, "activity", (u) =>
    hasCapability(u, CAPABILITIES.ACTIVITY_SCAN),
  );
  if (scanners.length > 0) {
    ctx.activities = await loadLiveScannableActivities(db);
    if (ctx.activities.length > 0) {
      ctx.scannedCounts = await loadScannedCounts(
        ctx.activities.map((a) => a.id),
        db,
      );
      // H24/H25: accredited people are the denominator of `scanned`.
      if (ctx.activities.some((a) => now >= a.startsAt)) {
        ctx.accreditationCounts = await accreditationCounts();
      }
    }
  }

  // Attendee schedule items (H59).
  const attendees = usersAllowed(users, "attendee_activity");
  if (attendees.length > 0) {
    ctx.attendeeItems = await loadLiveAttendeeItems(db);
    if (ctx.attendeeItems.length > 0) {
      ctx.audiences = await attendeeScheduleAudiencesForUsers(attendees, db);
    }
  }

  // Submission deadline (H19, H20): participants with event access.
  const participants = usersAllowed(
    users,
    "deadline",
    (u) => u.eventAccess && hasCapability(u, CAPABILITIES.QUEUE_STATUS),
  );
  if (participants.length > 0) {
    ctx.deadline = await readDeadlineWindow(db);
    if (ctx.deadline) ctx.submissions = await loadSubmissionFacts(participants, db);
  }

  // Accreditation desk (H22, H24).
  const accreditors = usersAllowed(users, "accreditation", (u) =>
    hasCapability(u, CAPABILITIES.ACCREDIT_SCAN),
  );
  if (accreditors.length > 0) {
    ctx.accreditation = await readAccreditationWindow(db);
    if (ctx.accreditation) {
      ctx.accreditationCounts = await accreditationCounts();
      // The presence estimate covers real accounts only.
      if (accreditors.some((id) => !users.get(id)?.isTestAccount)) {
        ctx.inside = await presentCount();
      }
    }
  }
  return ctx;
}

/**
 * Every Live Activity `userId` may have now, in priority order: kinds by
 * their configured priority, then each kind's own order (earliest activity
 * first). Props carry no `rank` yet.
 */
export async function candidatesFor(
  userId: number,
  language: Language,
  ctx: LiveActivityContext,
): Promise<Candidate[]> {
  const user = ctx.users.get(userId);
  if (!user) return [];
  const { now } = ctx;
  const out: Candidate[] = [];
  const add = (kind: LiveActivityConfigKind, subject: string, props: LiveActivityProps) =>
    out.push({ kind, subject, props, priority: ctx.priority.get(kind) ?? 1_000 });

  if (user.kinds.has("activity") && hasCapability(user, CAPABILITIES.ACTIVITY_SCAN)) {
    for (const activity of ctx.activities) {
      const scanned = ctx.scannedCounts.get(scannedKey(activity.id, user.isTestAccount)) ?? 0;
      // Same H54 side as `scanned`; null when that side has no accounts.
      const accredited = ctx.accreditationCounts.get(user.isTestAccount)?.accredited ?? null;
      add(
        "activity",
        activityLiveActivitySubject(activity.id),
        buildActivityLiveProps(activity, scanned, accredited, language, now),
      );
    }
  }

  if (user.kinds.has("attendee_activity")) {
    const audiences = ctx.audiences.get(userId);
    for (const item of ctx.attendeeItems) {
      if (!audiences || !item.audiences.some((a) => audiences.has(a))) continue;
      add(
        "attendee_activity",
        attendeeActivityLiveActivitySubject(item.id),
        buildAttendeeActivityLiveProps(item, language, now),
      );
    }
  }

  if (user.kinds.has("queue")) {
    const statuses = ctx.queueStatuses.get(userId);
    const queue = statuses ? selectQueueLiveProps(statuses, language, now) : null;
    if (queue) add("queue", QUEUE_LIVE_ACTIVITY_SUBJECT, queue);
  }

  if (
    ctx.accreditation &&
    user.kinds.has("accreditation") &&
    hasCapability(user, CAPABILITIES.ACCREDIT_SCAN)
  ) {
    add(
      "accreditation",
      ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
      buildAccreditationLiveProps(
        ctx.accreditation,
        ctx.accreditationCounts.get(user.isTestAccount),
        user.isTestAccount ? null : ctx.inside,
        language,
        now,
      ),
    );
  }

  if (
    ctx.deadline &&
    user.kinds.has("deadline") &&
    user.eventAccess &&
    hasCapability(user, CAPABILITIES.QUEUE_STATUS)
  ) {
    add(
      "deadline",
      DEADLINE_LIVE_ACTIVITY_SUBJECT,
      buildDeadlineLiveProps(ctx.deadline, ctx.submissions.get(userId), language, now),
    );
  }

  // Stable: within a kind the insertion order above is kept.
  return out.sort((a, b) => a.priority - b.priority);
}

/** What the device already knows about a subject (from live_activity_sessions). */
export interface KnownSession {
  open: boolean;
  dismissed: boolean;
  dismissedPhase: string | null;
}

export interface Selection {
  /** Candidates the device should show, with `rank` set in their props. */
  shown: Candidate[];
  /**
   * Candidates the user dismissed in their current phase: still relevant, so
   * the worker keeps their dismissal, but they take no slot.
   */
  suppressed: Candidate[];
}

/**
 * Keeps at most `maxConcurrent` candidates for one device. Order: kind
 * priority, then — the hysteresis — subjects already open on the device
 * before new ones of the same kind, then the kind's own order. A new
 * candidate of a higher-priority kind displaces a running lower one (which
 * is ended and restarts when a slot frees); within a kind a running activity
 * is never swapped for a new one, so two activities never flap.
 */
export function selectForDevice(
  candidates: Candidate[],
  known: (candidate: Candidate) => KnownSession | undefined,
  maxConcurrent: number,
): Selection {
  const suppressed: Candidate[] = [];
  const eligible: { candidate: Candidate; open: boolean; index: number }[] = [];
  candidates.forEach((candidate, index) => {
    const session = known(candidate);
    if (
      session?.dismissed &&
      (session.dismissedPhase === null || session.dismissedPhase === candidate.props.phase)
    ) {
      suppressed.push(candidate);
      return;
    }
    eligible.push({ candidate, open: session?.open === true, index });
  });
  eligible.sort(
    (a, b) =>
      a.candidate.priority - b.candidate.priority ||
      Number(b.open) - Number(a.open) ||
      a.index - b.index,
  );
  const shown = eligible.slice(0, maxConcurrent).map(({ candidate }, rank) => ({
    ...candidate,
    props: { ...candidate.props, rank } as LiveActivityProps,
  }));
  return { shown, suppressed };
}

/**
 * `GET /api/me/live-activities` for one user (the app's foreground source).
 * With `deviceId` (the caller's own registered install) the per-device cut
 * also honors that device's open and dismissed sessions, exactly as the
 * worker does; without it, as for a device that shows nothing yet.
 */
export async function myLiveActivities(
  userId: number,
  language: Language,
  options: { deviceId?: string } = {},
): Promise<Required<MyLiveActivities>> {
  const now = new Date();
  const ctx = await loadLiveActivityContext([userId], now);
  const candidates = await candidatesFor(userId, language, ctx);
  const sessions = new Map<string, KnownSession>();
  if (options.deviceId && candidates.length > 0) {
    const { rows } = await pool.query<{
      kind: string;
      subject: string;
      ended_at: Date | null;
      end_reason: string | null;
      dismissed_phase: string | null;
    }>(
      `SELECT s.kind, s.subject, s.ended_at, s.end_reason, s.dismissed_phase
         FROM live_activity_sessions s
         JOIN live_activity_devices d ON d.id = s.device_id
        WHERE d.device_id = $1 AND d.user_id = $2`,
      [options.deviceId, userId],
    );
    for (const row of rows) {
      sessions.set(`${row.kind}|${row.subject}`, {
        open: row.ended_at === null,
        dismissed: row.end_reason === "dismissed",
        dismissedPhase: row.dismissed_phase,
      });
    }
  }
  const { shown } = selectForDevice(
    candidates,
    (c) => sessions.get(`${c.kind}|${c.subject}`),
    ctx.maxConcurrent,
  );
  const of = <P extends LiveActivityProps>(kind: LiveActivityKind) =>
    shown.filter((c) => c.kind === kind).map((c) => c.props as P);
  return {
    judgingWindowOpen: ctx.judgingWindow.open,
    queue: of<QueueLiveProps>("queue")[0] ?? null,
    activities: of<ActivityLiveProps>("activity"),
    attendeeActivities: of<AttendeeActivityLiveProps>("attendee_activity"),
    deadline: of<DeadlineLiveProps>("deadline")[0] ?? null,
    accreditation: of<AccreditationLiveProps>("accreditation")[0] ?? null,
    maxConcurrent: ctx.maxConcurrent,
  };
}
