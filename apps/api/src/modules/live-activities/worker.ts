import type {
  AndroidLiveUpdateMessage,
  LiveActivityKind,
  LiveActivityProps,
} from "@hackos/shared/live-activities";
import {
  activityLiveActivitySubject,
  QUEUE_LIVE_ACTIVITY_SUBJECT,
} from "@hackos/shared/live-activities";
import type { Language } from "@hackos/shared/locale";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { normalizeLanguage } from "../notifications/templates.js";
import { type AndroidLiveUpdateTransport, expoAndroidTransport } from "./android.js";
import {
  type ApnsAlert,
  type ApnsTransport,
  createApnsTransport,
  isDeadApnsToken,
  type LiveActivityEvent,
  liveActivityApnsPayload,
} from "./apns.js";
import {
  buildActivityLiveProps,
  type LiveScannableActivity,
  liveStateHash,
  loadLiveScannableActivities,
  loadScannedCounts,
  participantQueueStatuses,
  readJudgingWindow,
  scannedKey,
  selectQueueLiveProps,
  usersWithActivityScan,
} from "./state.js";

/**
 * Live Activity push worker (#966; H38, H25, H26). Every tick compares the
 * desired Live Activities (state.ts) of each enabled device with the
 * sessions the server knows about and sends the difference:
 *
 * - desired, no session (or one the server finished) + a start path
 *   (iOS push-to-start token, Android Expo token) → start;
 * - desired, open session, visible state changed → update (activity counter
 *   updates throttled to one per 30 s per session; queue changes and phase
 *   changes go out immediately);
 * - open session no longer desired (window closed, team finished, activity
 *   over, device disabled) → end.
 *
 * Concurrency: a session-level advisory lock admits one tick at a time
 * across worker replicas, and every send is preceded by an atomic row claim
 * (INSERT … ON CONFLICT for starts, conditional UPDATE … RETURNING for
 * updates/ends), so a retried or overlapping tick never sends twice. A failed
 * send reverts its claim so the next tick retries it.
 */

export const LIVE_ACTIVITIES_QUEUE = "live-activities";
const TICK_EVERY_MS = 20_000;
const ACTIVITY_UPDATE_THROTTLE_SECONDS = 30;
/** Arbitrary constant for pg_try_advisory_lock; unique among this codebase's advisory keys. */
const TICK_LOCK_KEY = 966_001;
/** Without an update for this long, iOS greys the queue activity out as stale. */
const QUEUE_STALE_MS = 30 * 60 * 1000;

interface DeviceRow {
  id: number;
  user_id: number;
  platform: "ios" | "android";
  push_to_start_token: string | null;
  expo_push_token: string | null;
  language: Language;
  is_test_account: boolean;
  eligible: boolean;
}

interface SessionRow {
  id: number;
  device_id: number;
  kind: LiveActivityKind;
  subject: string;
  activity_push_token: string | null;
  state_hash: string | null;
  props: LiveActivityProps | null;
  ended_at: Date | null;
  end_reason: "finished" | "dismissed" | null;
}

interface Desired {
  kind: LiveActivityKind;
  subject: string;
  props: LiveActivityProps;
}

export interface LiveActivityTickDeps {
  /** null = APNs not configured; undefined = build the real HTTP/2 transport. */
  apns?: ApnsTransport | null;
  android?: AndroidLiveUpdateTransport;
}

export interface LiveActivityTickSummary {
  skipped: boolean;
  started: number;
  updated: number;
  ended: number;
  failed: number;
}

type SendResult = "ok" | "gone" | "error" | "skipped";

const sessionKey = (deviceId: number, kind: string, subject: string) =>
  `${deviceId}|${kind}|${subject}`;

let warnedApnsMissing = false;

function timeRange(props: { startsAt: string; endsAt: string }, timezone: string): string {
  const format = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  });
  return `${format.format(new Date(props.startsAt))}–${format.format(new Date(props.endsAt))}`;
}

/**
 * The alert iOS requires on a remote start, and the single essential update
 * alert (HIG): the team being called. No sound: the queue.called
 * notification (H51, non-optional) already rings.
 */
function alertFor(props: LiveActivityProps, timezone: string): ApnsAlert {
  if (props.kind === "activity") {
    const range = timeRange(props, timezone);
    return { title: props.name, body: props.location ? `${range} · ${props.location}` : range };
  }
  const { labels } = props;
  if (props.phase === "waiting") {
    const position = props.position != null ? `${labels.position} #${props.position}` : "";
    const eta = props.etaMinutes != null ? `~${props.etaMinutes} ${labels.minutes}` : "";
    return { title: props.challengeTitle, body: [position, eta].filter(Boolean).join(" · ") };
  }
  const room = [props.roomName, props.roomLocation].filter(Boolean).join(" — ");
  const prefix = props.phase === "called" ? labels.goTo : labels.inRoom;
  return { title: props.challengeTitle, body: room ? `${prefix} ${room}` : prefix };
}

function staleDateFor(props: LiveActivityProps, now: Date): Date {
  return props.kind === "activity"
    ? new Date(props.endsAt)
    : new Date(now.getTime() + QUEUE_STALE_MS);
}

function relevanceFor(props: LiveActivityProps): number {
  if (props.kind === "queue") return props.phase === "waiting" ? 50 : 100;
  return props.phase === "live" ? 75 : 25;
}

async function loadDevices(): Promise<DeviceRow[]> {
  const { rows } = await pool.query<
    Omit<DeviceRow, "language"> & { language: string | null; user_language: string | null }
  >(
    `SELECT d.id, d.user_id, d.platform, d.push_to_start_token, d.expo_push_token,
            d.language, u.language AS user_language, u.is_test_account,
            (d.enabled AND u.account_state = 'active' AND u.anonymized_at IS NULL) AS eligible
       FROM live_activity_devices d
       JOIN users u ON u.id = d.user_id
      WHERE (d.enabled AND u.account_state = 'active' AND u.anonymized_at IS NULL)
         OR EXISTS (
           SELECT 1 FROM live_activity_sessions s WHERE s.device_id = d.id AND s.ended_at IS NULL
         )
      ORDER BY d.id`,
  );
  return rows.map((row) => ({
    ...row,
    language: normalizeLanguage(row.language ?? row.user_language),
  }));
}

async function loadSessions(deviceIds: number[]): Promise<Map<string, SessionRow>> {
  const sessions = new Map<string, SessionRow>();
  if (deviceIds.length === 0) return sessions;
  const { rows } = await pool.query<SessionRow>(
    `SELECT id, device_id, kind, subject, activity_push_token, state_hash, props, ended_at, end_reason
       FROM live_activity_sessions WHERE device_id = ANY($1::int[])`,
    [deviceIds],
  );
  for (const row of rows) sessions.set(sessionKey(row.device_id, row.kind, row.subject), row);
  return sessions;
}

export async function runLiveActivitiesTick(
  deps: LiveActivityTickDeps = {},
): Promise<LiveActivityTickSummary> {
  const summary: LiveActivityTickSummary = {
    skipped: false,
    started: 0,
    updated: 0,
    ended: 0,
    failed: 0,
  };
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [TICK_LOCK_KEY],
    );
    locked = rows[0]?.locked === true;
    if (!locked) return { ...summary, skipped: true };
    await tick(deps, summary);
    return summary;
  } finally {
    if (locked) await lockClient.query(`SELECT pg_advisory_unlock($1)`, [TICK_LOCK_KEY]);
    lockClient.release();
  }
}

async function tick(deps: LiveActivityTickDeps, summary: LiveActivityTickSummary): Promise<void> {
  const now = new Date();
  const devices = await loadDevices();
  if (devices.length === 0) return;
  const sessions = await loadSessions(devices.map((d) => d.id));
  const hasOpenSession = new Set(
    [...sessions.values()].filter((s) => s.ended_at === null).map((s) => s.device_id),
  );

  // Only devices that can receive something this tick are worth computing:
  // a start path, or an activity already open on them.
  const actionable = devices.filter(
    (d) =>
      d.eligible &&
      (hasOpenSession.has(d.id) ||
        (d.platform === "ios" ? d.push_to_start_token !== null : d.expo_push_token !== null)),
  );
  const userIds = [...new Set(actionable.map((d) => d.user_id))];

  const window = await readJudgingWindow();
  const queueStatuses = new Map<number, Awaited<ReturnType<typeof participantQueueStatuses>>>();
  if (window.open) {
    // Bounded: only users with an actionable device, and myQueueStatus only
    // for those with queue entries (participantQueueStatuses pre-checks).
    for (const userId of userIds) {
      queueStatuses.set(userId, await participantQueueStatuses(userId));
    }
  }

  let activities: LiveScannableActivity[] = [];
  let scanners = new Set<number>();
  let counts = new Map<string, number>();
  let timezone = "UTC";
  if (userIds.length > 0) {
    activities = await loadLiveScannableActivities();
    if (activities.length > 0) {
      scanners = await usersWithActivityScan(userIds);
      counts = await loadScannedCounts(activities.map((a) => a.id));
    }
  }
  if (activities.length > 0 || window.open) {
    const { rows } = await pool.query<{ timezone: string | null }>(
      `SELECT timezone FROM event_config WHERE id = 1`,
    );
    timezone = rows[0]?.timezone || "UTC";
  }

  const apns = deps.apns === undefined ? createApnsTransport() : deps.apns;
  if (!apns && !warnedApnsMissing && devices.some((d) => d.platform === "ios")) {
    warnedApnsMissing = true;
    console.warn("live-activities: APNs is not configured; skipping iOS Live Activity pushes");
  }
  const android = deps.android ?? expoAndroidTransport;
  const ctx: SendContext = { apns, android, now, timezone, summary };

  try {
    const actionableIds = new Set(actionable.map((d) => d.id));
    for (const device of devices) {
      const desired: Desired[] = [];
      if (actionableIds.has(device.id)) {
        const statuses = queueStatuses.get(device.user_id);
        const queueProps = statuses ? selectQueueLiveProps(statuses, device.language, now) : null;
        if (queueProps) {
          desired.push({ kind: "queue", subject: QUEUE_LIVE_ACTIVITY_SUBJECT, props: queueProps });
        }
        if (scanners.has(device.user_id)) {
          for (const activity of activities) {
            const scanned = counts.get(scannedKey(activity.id, device.is_test_account)) ?? 0;
            desired.push({
              kind: "activity",
              subject: activityLiveActivitySubject(activity.id),
              props: buildActivityLiveProps(activity, scanned, device.language, now),
            });
          }
        }
      }

      const desiredKeys = new Set<string>();
      for (const want of desired) {
        const key = sessionKey(device.id, want.kind, want.subject);
        desiredKeys.add(key);
        const session = sessions.get(key);
        if (!session || session.end_reason === "finished") {
          await startSession(ctx, device, want);
        } else if (session.ended_at === null) {
          await updateSession(ctx, device, session, want);
        }
        // A dismissed session stays dismissed: the user chose to remove it.
      }

      for (const session of sessions.values()) {
        if (session.device_id !== device.id || session.ended_at !== null) continue;
        if (desiredKeys.has(sessionKey(device.id, session.kind, session.subject))) continue;
        await endSession(ctx, device, session);
      }
    }
  } finally {
    apns?.close();
  }
}

interface SendContext {
  apns: ApnsTransport | null;
  android: AndroidLiveUpdateTransport;
  now: Date;
  timezone: string;
  summary: LiveActivityTickSummary;
}

async function send(
  ctx: SendContext,
  device: DeviceRow,
  input: {
    event: LiveActivityEvent;
    kind: LiveActivityKind;
    subject: string;
    props: LiveActivityProps | null;
    token: string | null;
    alert?: ApnsAlert;
    priority: 5 | 10;
  },
): Promise<SendResult> {
  try {
    if (device.platform === "android") {
      if (!input.token) return "skipped";
      const message: AndroidLiveUpdateMessage = {
        hackosLiveUpdate: {
          event: input.event,
          kind: input.kind,
          subject: input.subject,
          ...(input.event !== "end" && input.props ? { props: input.props } : {}),
        },
      };
      return await ctx.android.send(input.token, message);
    }
    if (!ctx.apns || !input.token || !input.props) return "skipped";
    const response = await ctx.apns.send({
      token: input.token,
      priority: input.priority,
      payload: liveActivityApnsPayload({
        event: input.event,
        kind: input.kind,
        props: input.props,
        now: ctx.now,
        alert: input.alert,
        staleDate: input.event === "end" ? undefined : staleDateFor(input.props, ctx.now),
        relevanceScore: relevanceFor(input.props),
      }),
    });
    if (response.status === 200) return "ok";
    if (isDeadApnsToken(response)) return "gone";
    console.warn("live-activities: APNs rejected a push", {
      event: input.event,
      kind: input.kind,
      status: response.status,
      reason: response.reason ?? null,
    });
    return "error";
  } catch (err) {
    console.warn("live-activities: push failed", {
      event: input.event,
      kind: input.kind,
      platform: device.platform,
      error: err instanceof Error ? err.message : String(err),
    });
    return "error";
  }
}

async function forgetDeviceToken(device: DeviceRow): Promise<void> {
  if (device.platform === "ios") {
    await pool.query(
      `UPDATE live_activity_devices SET push_to_start_token = NULL
        WHERE id = $1 AND push_to_start_token = $2`,
      [device.id, device.push_to_start_token],
    );
  } else {
    await pool.query(
      `UPDATE live_activity_devices SET expo_push_token = NULL
        WHERE id = $1 AND expo_push_token = $2`,
      [device.id, device.expo_push_token],
    );
  }
}

async function startSession(ctx: SendContext, device: DeviceRow, want: Desired): Promise<void> {
  const token = device.platform === "ios" ? device.push_to_start_token : device.expo_push_token;
  if (!token || (device.platform === "ios" && !ctx.apns)) return;
  const hash = liveStateHash(want.props);
  // Idempotent claim: only the tick whose INSERT (or restart of a session
  // the server itself finished) succeeds may send the start.
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO live_activity_sessions
       (device_id, kind, subject, state_hash, props, last_sent_at, started_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (device_id, kind, subject) DO UPDATE
       SET ended_at = NULL, end_reason = NULL, activity_push_token = NULL,
           state_hash = EXCLUDED.state_hash, props = EXCLUDED.props,
           last_sent_at = now(), started_at = now()
       WHERE live_activity_sessions.end_reason = 'finished'
     RETURNING id`,
    [device.id, want.kind, want.subject, hash, JSON.stringify(want.props)],
  );
  const sessionId = rows[0]?.id;
  if (sessionId === undefined) return;

  const result = await send(ctx, device, {
    event: "start",
    kind: want.kind,
    subject: want.subject,
    props: want.props,
    token,
    alert: alertFor(want.props, ctx.timezone),
    priority: 10,
  });
  if (result === "ok") {
    ctx.summary.started += 1;
    return;
  }
  // Release the claim so a later tick can retry — unless the app already
  // registered the activity it started itself in the meantime.
  await pool.query(
    `DELETE FROM live_activity_sessions
      WHERE id = $1 AND state_hash = $2 AND activity_push_token IS NULL`,
    [sessionId, hash],
  );
  if (result === "gone") await forgetDeviceToken(device);
  else ctx.summary.failed += 1;
}

async function updateSession(
  ctx: SendContext,
  device: DeviceRow,
  session: SessionRow,
  want: Desired,
): Promise<void> {
  const hash = liveStateHash(want.props);
  if (session.state_hash === hash) return;
  const token = device.platform === "ios" ? session.activity_push_token : device.expo_push_token;
  // iOS can't be updated until the app reports the activity's own token.
  if (!token || (device.platform === "ios" && !ctx.apns)) return;

  const previousPhase = session.props?.phase ?? null;
  const phaseChanged = previousPhase !== want.props.phase;
  const urgent = want.kind === "queue" || phaseChanged;
  const { rows } = await pool.query<{ id: number }>(
    `UPDATE live_activity_sessions
        SET state_hash = $2, props = $3, last_sent_at = now()
      WHERE id = $1 AND ended_at IS NULL
        AND state_hash IS NOT DISTINCT FROM $4
        AND ($5::boolean OR last_sent_at IS NULL
             OR last_sent_at <= now() - make_interval(secs => $6))
      RETURNING id`,
    [
      session.id,
      hash,
      JSON.stringify(want.props),
      session.state_hash,
      urgent,
      ACTIVITY_UPDATE_THROTTLE_SECONDS,
    ],
  );
  if (rows.length === 0) return;

  const called =
    want.props.kind === "queue" && want.props.phase === "called" && previousPhase !== "called";
  const result = await send(ctx, device, {
    event: "update",
    kind: want.kind,
    subject: want.subject,
    props: want.props,
    token,
    alert: called ? alertFor(want.props, ctx.timezone) : undefined,
    priority: called || phaseChanged ? 10 : 5,
  });
  if (result === "ok") {
    ctx.summary.updated += 1;
    return;
  }
  if (result === "gone") {
    await markGone(device, session);
    return;
  }
  if (result === "error") ctx.summary.failed += 1;
  await pool.query(
    `UPDATE live_activity_sessions SET state_hash = $3, props = $4
      WHERE id = $1 AND state_hash = $2`,
    [session.id, hash, session.state_hash, session.props ? JSON.stringify(session.props) : null],
  );
}

/** The token is dead: on iOS the activity is gone from the device; never restart it remotely. */
async function markGone(device: DeviceRow, session: SessionRow): Promise<void> {
  if (device.platform === "android") {
    await forgetDeviceToken(device);
    return;
  }
  await pool.query(
    `UPDATE live_activity_sessions
        SET activity_push_token = NULL, ended_at = COALESCE(ended_at, now()),
            end_reason = 'dismissed'
      WHERE id = $1`,
    [session.id],
  );
}

async function endSession(ctx: SendContext, device: DeviceRow, session: SessionRow): Promise<void> {
  const { rows } = await pool.query<{ id: number }>(
    `UPDATE live_activity_sessions SET ended_at = now(), end_reason = 'finished'
      WHERE id = $1 AND ended_at IS NULL
      RETURNING id`,
    [session.id],
  );
  if (rows.length === 0) return;
  const token = device.platform === "ios" ? session.activity_push_token : device.expo_push_token;
  const finalProps = session.props
    ? ({ ...session.props, updatedAt: ctx.now.toISOString() } as LiveActivityProps)
    : null;
  const result = await send(ctx, device, {
    event: "end",
    kind: session.kind,
    subject: session.subject,
    props: finalProps,
    token,
    priority: 10,
  });
  if (result === "ok" || result === "skipped") {
    ctx.summary.ended += 1;
    return;
  }
  if (result === "gone") {
    await markGone(device, session);
    ctx.summary.ended += 1;
    return;
  }
  ctx.summary.failed += 1;
  await pool.query(
    `UPDATE live_activity_sessions SET ended_at = NULL, end_reason = NULL
      WHERE id = $1 AND end_reason = 'finished'`,
    [session.id],
  );
}

registerWorker(LIVE_ACTIVITIES_QUEUE, async () => {
  await runLiveActivitiesTick();
});

export async function scheduleLiveActivitiesWorker(): Promise<void> {
  if (config.isTest) return;
  await getQueue(LIVE_ACTIVITIES_QUEUE).add(
    LIVE_ACTIVITIES_QUEUE,
    {},
    {
      repeat: { every: TICK_EVERY_MS },
      jobId: LIVE_ACTIVITIES_QUEUE,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

/**
 * Best-effort early tick after a queue call (H29/H38) so the "go to room"
 * update doesn't wait for the next 20 s repetition. Delayed so the caller's
 * transaction has committed; deduplicated while one is pending. A failure is
 * logged, never surfaced: the repeatable tick delivers the same state anyway.
 */
export async function requestLiveActivitySync(): Promise<void> {
  if (config.isTest) return;
  try {
    await getQueue(LIVE_ACTIVITIES_QUEUE).add(
      LIVE_ACTIVITIES_QUEUE,
      {},
      {
        delay: 2_000,
        jobId: `${LIVE_ACTIVITIES_QUEUE}-nudge`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch (err) {
    console.warn("live-activities: could not schedule an early sync", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
