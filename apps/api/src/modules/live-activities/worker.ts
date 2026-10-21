import {
  type AndroidLiveUpdateMessage,
  COUNTDOWN_FLAG_KEYS,
  LIVE_ACTIVITY_OPEN_ENDED_STALE_MS,
  type LiveActivityKind,
  type LiveActivityProps,
  liveActivityStaleDate,
  nextCountdownBoundary,
  relevanceForRank,
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
  candidatesFor,
  type KnownSession,
  loadLiveActivityContext,
  selectForDevice,
} from "./candidates.js";
import { foregroundDevices } from "./foreground.js";
import {
  LIVE_ACTIVITIES_BOUNDARY_JOB,
  LIVE_ACTIVITIES_KICK_JOB,
  LIVE_ACTIVITIES_QUEUE,
  requestLiveActivitySync,
  scheduleLiveActivityBoundaries,
} from "./kick.js";
import { liveStateHash } from "./state.js";

/**
 * Live Activity push worker (#966; H38, H25, H26, H59, H19, H22).
 * Every tick compares the desired Live Activities of each enabled device —
 * the user's candidates (candidates.ts: kind configuration, role and
 * intrinsic gates) cut to the device's `maxConcurrent` — with the sessions
 * the server knows about and sends the difference:
 *
 * - desired, no session (or one the server finished, or one the user
 *   dismissed in a different phase) + a start path
 *   (iOS push-to-start token, Android Expo token) → start;
 * - desired, open session, visible state changed → update (counter updates
 *   of staff/attendee activities, the deadline and the accreditation desk
 *   are throttled to one per 30 s per session; queue changes, phase changes
 *   and rescheduling go out immediately, and so do the countdown format
 *   flags (#966), which exist to re-render the widget on time);
 * - desired, open iOS session near ActivityKit's 8-hour limit → end it at
 *   once and push-start a fresh one, so a long window (the hacking period)
 *   stays on screen;
 * - open session no longer desired (window closed, team finished, activity
 *   over, kind disabled or not allowed, outranked by a higher-priority kind,
 *   device disabled) → end; a dismissed one no longer relevant → finished, so
 *   the subject's next run starts again.
 *
 * Concurrency: a session-level advisory lock admits one tick at a time
 * across worker replicas, and every send is preceded by an atomic row claim
 * (INSERT … ON CONFLICT for starts, conditional UPDATE … RETURNING for
 * updates/ends), so a retried or overlapping tick never sends twice. A failed
 * send reverts its claim so the next tick retries it.
 */

const TICK_EVERY_MS = 20_000;
const ACTIVITY_UPDATE_THROTTLE_SECONDS = 30;
/** Arbitrary constant for pg_try_advisory_lock; unique among this codebase's advisory keys. */
const TICK_LOCK_KEY = 966_001;
/**
 * An unchanged queue state is re-sent after this long, so a team waiting
 * without any visible change is not greyed out (its `stale-date` is 30 min
 * ahead, `liveActivityStaleDate`).
 */
const OPEN_ENDED_REFRESH_MS = LIVE_ACTIVITY_OPEN_ENDED_STALE_MS / 2;
/**
 * ActivityKit ends an activity after 8 h and removes it from the Lock Screen
 * at most 4 h later. An iOS session the server could never address (no
 * per-activity token) is gone from the device by then.
 */
const IOS_ACTIVITY_LIFETIME_MS = 12 * 60 * 60 * 1000;
/**
 * An iOS activity still desired this close to ActivityKit's 8-hour limit is
 * replaced (ended at once, push-started again) before the system ends it:
 * the deadline runs for the whole hacking period (H19), which can be longer.
 */
const IOS_ACTIVITY_ROTATE_MS = (8 * 60 - 15) * 60 * 1000;

/** Kinds whose every change goes out immediately (no counter throttle). */
const URGENT_KINDS = new Set<LiveActivityKind>(["queue"]);
const OPEN_ENDED_KINDS = new Set<LiveActivityKind>(["queue"]);

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
  last_sent_at: Date | null;
  started_at: Date;
  ended_at: Date | null;
  end_reason: "finished" | "dismissed" | null;
  dismissed_phase: string | null;
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

function clock(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(instant));
}

function timeRange(props: { startsAt: string; endsAt: string }, timezone: string): string {
  return `${clock(props.startsAt, timezone)}–${clock(props.endsAt, timezone)}`;
}

/**
 * The alert iOS requires on a remote start (shown without sound), and the
 * only alerting updates (HIG: essential changes only): the team being called
 * (queue) and submissions entering their last minutes while the team's
 * project is unsubmitted (deadline). The queue.called notification (H51,
 * non-optional) already rings, so no alert carries a sound.
 */
export function alertFor(props: LiveActivityProps, timezone: string): ApnsAlert {
  switch (props.kind) {
    case "activity":
    case "attendee_activity": {
      const range = timeRange(props, timezone);
      return { title: props.name, body: props.location ? `${range} · ${props.location}` : range };
    }
    case "deadline": {
      const closes = `${props.labels.closesIn} ${clock(props.endsAt, timezone)}`;
      if (props.phase === "submitted") {
        return { title: props.labels.title, body: `${props.labels.submitted} · ${closes}` };
      }
      const status = props.phase === "closing" ? props.labels.notSubmitted : null;
      return {
        title: props.labels.title,
        body: [status, props.projectName, closes].filter(Boolean).join(" · "),
      };
    }
    case "accreditation":
      return {
        title: props.labels.title,
        body: `${props.labels.accredited} ${props.accredited}/${props.eligible}`,
      };
    case "queue": {
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
  }
}

/**
 * The item itself moved or was renamed (a schedule or event-timing edit, H25,
 * H59, H19): the countdown must follow now, so it is not throttled like a
 * counter.
 */
function rescheduled(previous: LiveActivityProps | null, next: LiveActivityProps): boolean {
  if (!previous || previous.kind !== next.kind) return false;
  const before = previous as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  return ["startsAt", "endsAt", "name", "location"].some((field) => before[field] !== after[field]);
}

/** The one update that alerts, if this transition is it. */
function updateAlert(props: LiveActivityProps, previousPhase: string | null): boolean {
  if (props.kind === "queue") return props.phase === "called" && previousPhase !== "called";
  if (props.kind === "deadline") return props.phase === "closing" && previousPhase !== "closing";
  return false;
}

/**
 * The next instants a desired activity changes on its own: the start while
 * upcoming, the end while live and a deadline's end (H19, H25, H26, H59), and the next countdown format
 * boundary (#966: one-digit minutes or seconds, colon notation, the hour), so
 * the precision flags flip, and the widget re-renders, on time.
 */
function boundaryInstants(props: LiveActivityProps, now: Date): Date[] {
  if (props.kind !== "activity" && props.kind !== "attendee_activity" && props.kind !== "deadline")
    return [];
  const out: Date[] = [];
  // The instant it changes phase or ends (a deadline ends at `endsAt`): the
  // tick lands right then and the activity is removed at 0:00, not on the next
  // 20 s repetition.
  const phaseAt = new Date(
    props.kind !== "deadline" && props.phase === "upcoming" ? props.startsAt : props.endsAt,
  );
  if (Number.isFinite(phaseAt.getTime()) && phaseAt > now) out.push(phaseAt);
  const target =
    props.kind !== "deadline" && props.phase === "upcoming" ? props.startsAt : props.endsAt;
  const precisionAt = nextCountdownBoundary(target, now);
  if (precisionAt !== null) out.push(new Date(precisionAt));
  return out;
}

/** Whether a countdown format flag changed: its update must not wait out the counter throttle. */
function precisionChanged(previous: LiveActivityProps | null, next: LiveActivityProps): boolean {
  if (!previous || previous.kind !== next.kind) return false;
  const before = previous as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  return COUNTDOWN_FLAG_KEYS.some((key) => (before[key] ?? false) !== (after[key] ?? false));
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
    `SELECT id, device_id, kind, subject, activity_push_token, state_hash, props, last_sent_at,
            started_at, ended_at, end_reason, dismissed_phase
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
  const ctx = await loadLiveActivityContext(userIds, now);

  let timezone = "UTC";
  if (userIds.length > 0) {
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
  const foreground = await foregroundDevices(
    actionable.filter((d) => d.platform === "ios").map((d) => d.id),
  );
  const sendCtx: SendContext = { apns, android, now, timezone, summary, foreground };

  // Phase boundaries of the desired activities, each ticked on time.
  const boundaries = new Map<number, Date>();
  try {
    const actionableIds = new Set(actionable.map((d) => d.id));
    for (const device of devices) {
      const desired: Desired[] = [];
      if (actionableIds.has(device.id)) {
        const candidates = await candidatesFor(device.user_id, device.language, ctx);
        const { shown, suppressed } = selectForDevice(
          candidates,
          (c): KnownSession | undefined => {
            const session = sessions.get(sessionKey(device.id, c.kind, c.subject));
            if (!session) return undefined;
            return {
              open: session.ended_at === null,
              dismissed: session.end_reason === "dismissed",
              dismissedPhase: session.dismissed_phase,
            };
          },
          ctx.maxConcurrent,
        );
        // Suppressed (dismissed in this phase) stay desired so their
        // dismissal is kept; the branches below send them nothing.
        desired.push(...shown, ...suppressed);
      }

      const desiredKeys = new Set<string>();
      for (const want of desired) {
        for (const boundary of boundaryInstants(want.props, now)) {
          boundaries.set(boundary.getTime(), boundary);
        }
        const key = sessionKey(device.id, want.kind, want.subject);
        desiredKeys.add(key);
        const session = sessions.get(key);
        if (!session || session.end_reason === "finished") {
          await startSession(sendCtx, device, want, session);
        } else if (session.ended_at === null) {
          if (dueForRotation(sendCtx, device, session)) {
            await rotateSession(sendCtx, device, session, want);
          } else {
            await updateSession(sendCtx, device, session, want);
          }
        } else if (session.dismissed_phase === null) {
          // Dismissed before the server knew its phase: remember the phase
          // the user dismissed, so only a later change brings it back.
          await pool.query(
            `UPDATE live_activity_sessions SET dismissed_phase = $2
              WHERE id = $1 AND end_reason = 'dismissed' AND dismissed_phase IS NULL`,
            [session.id, want.props.phase],
          );
        } else if (session.dismissed_phase !== want.props.phase) {
          // The user swiped it away, but its phase changed since (e.g.
          // waiting → called): that is new, essential information.
          await startSession(sendCtx, device, want, session);
        }
      }

      for (const session of sessions.values()) {
        if (session.device_id !== device.id) continue;
        if (desiredKeys.has(sessionKey(device.id, session.kind, session.subject))) continue;
        if (session.ended_at === null) {
          await endSession(sendCtx, device, session);
        } else if (session.end_reason === "dismissed" && actionableIds.has(device.id)) {
          // A dismissal covers the run of the subject the user swiped away.
          // Once it is no longer relevant at all (team done, window closed),
          // a later run (e.g. the next queue the team waits in) is new.
          await pool.query(
            `UPDATE live_activity_sessions SET end_reason = 'finished', dismissed_phase = NULL
              WHERE id = $1 AND end_reason = 'dismissed' AND ended_at < $2`,
            [session.id, now],
          );
        }
      }
    }
  } finally {
    apns?.close();
  }
  await scheduleLiveActivityBoundaries([...boundaries.values()]);
}

interface SendContext {
  apns: ApnsTransport | null;
  android: AndroidLiveUpdateTransport;
  now: Date;
  timezone: string;
  summary: LiveActivityTickSummary;
  /** iOS devices whose app is starting its own activities right now (foreground.ts). */
  foreground: Set<number>;
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
    /** End only: remove it from the Lock Screen at once (a rotation). */
    dismissNow?: boolean;
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
          ...(input.event !== "end" && input.props
            ? { props: input.props, rank: input.props.rank ?? 0 }
            : {}),
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
        staleDate: input.event === "end" ? undefined : liveActivityStaleDate(input.props, ctx.now),
        relevanceScore: relevanceForRank(input.props.rank),
        dismissalDate: input.dismissNow ? ctx.now : undefined,
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

async function startSession(
  ctx: SendContext,
  device: DeviceRow,
  want: Desired,
  previous: SessionRow | undefined,
): Promise<void> {
  const token = device.platform === "ios" ? device.push_to_start_token : device.expo_push_token;
  if (!token || (device.platform === "ios" && !ctx.apns)) return;
  // The app in the foreground starts it itself; a push now would duplicate it.
  if (ctx.foreground.has(device.id)) return;
  const hash = liveStateHash(want.props);
  // Idempotent claim: only the tick whose INSERT (or restart of a session
  // the server finished, or one dismissed in another phase) succeeds may
  // send the start.
  const { rows } = await pool.query<{ id: number; inserted: boolean }>(
    `INSERT INTO live_activity_sessions
       (device_id, kind, subject, state_hash, props, last_sent_at, started_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (device_id, kind, subject) DO UPDATE
       SET ended_at = NULL, end_reason = NULL, dismissed_phase = NULL,
           activity_push_token = NULL,
           state_hash = EXCLUDED.state_hash, props = EXCLUDED.props,
           last_sent_at = now(), started_at = now()
       WHERE live_activity_sessions.end_reason = 'finished'
          OR (live_activity_sessions.end_reason = 'dismissed'
              AND live_activity_sessions.dismissed_phase IS NOT NULL
              AND live_activity_sessions.dismissed_phase <> $6)
     RETURNING id, (xmax = 0) AS inserted`,
    [device.id, want.kind, want.subject, hash, JSON.stringify(want.props), want.props.phase],
  );
  const sessionId = rows[0]?.id;
  if (sessionId === undefined) return;
  const inserted = rows[0]?.inserted === true;

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
  // registered the activity it started itself in the meantime. A restart
  // goes back to the ended row it claimed, so a dismissal keeps its phase.
  if (inserted || !previous) {
    await pool.query(
      `DELETE FROM live_activity_sessions
        WHERE id = $1 AND state_hash = $2 AND activity_push_token IS NULL AND ended_at IS NULL`,
      [sessionId, hash],
    );
  } else {
    await pool.query(
      `UPDATE live_activity_sessions
          SET ended_at = COALESCE($3::timestamptz, now()), end_reason = $4, dismissed_phase = $5,
              state_hash = $6, props = $7, last_sent_at = $8
        WHERE id = $1 AND state_hash = $2 AND activity_push_token IS NULL AND ended_at IS NULL`,
      [
        sessionId,
        hash,
        previous.ended_at,
        previous.end_reason ?? "finished",
        previous.dismissed_phase,
        previous.state_hash,
        previous.props ? JSON.stringify(previous.props) : null,
        previous.last_sent_at,
      ],
    );
  }
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
  const refreshDue =
    OPEN_ENDED_KINDS.has(want.kind) &&
    session.last_sent_at !== null &&
    ctx.now.getTime() - new Date(session.last_sent_at).getTime() >= OPEN_ENDED_REFRESH_MS;
  if (session.state_hash === hash && !refreshDue) return;
  const token = device.platform === "ios" ? session.activity_push_token : device.expo_push_token;
  // iOS can't be updated until the app reports the activity's own token.
  if (!token || (device.platform === "ios" && !ctx.apns)) return;

  const previousPhase = session.props?.phase ?? null;
  const phaseChanged = previousPhase !== want.props.phase;
  const moved = rescheduled(session.props, want.props);
  const urgent =
    URGENT_KINDS.has(want.kind) ||
    phaseChanged ||
    moved ||
    precisionChanged(session.props, want.props);
  const { rows } = await pool.query<{ id: number }>(
    `UPDATE live_activity_sessions
        SET state_hash = $2, props = $3, last_sent_at = now()
      WHERE id = $1 AND ended_at IS NULL
        AND state_hash IS NOT DISTINCT FROM $4
        AND ($5::boolean OR last_sent_at IS NULL
             OR last_sent_at <= now() - make_interval(secs => $6))
        -- A same-state refresh is claimed only while it is still due.
        AND (NOT $7::boolean OR last_sent_at <= now() - make_interval(secs => $8))
      RETURNING id`,
    [
      session.id,
      hash,
      JSON.stringify(want.props),
      session.state_hash,
      urgent,
      ACTIVITY_UPDATE_THROTTLE_SECONDS,
      session.state_hash === hash,
      OPEN_ENDED_REFRESH_MS / 1000,
    ],
  );
  if (rows.length === 0) return;

  const alerting = updateAlert(want.props, previousPhase);
  const result = await send(ctx, device, {
    event: "update",
    kind: want.kind,
    subject: want.subject,
    props: want.props,
    token,
    alert: alerting ? alertFor(want.props, ctx.timezone) : undefined,
    priority: alerting || phaseChanged || moved ? 10 : 5,
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
    `UPDATE live_activity_sessions SET state_hash = $3, props = $4, last_sent_at = $5
      WHERE id = $1 AND state_hash = $2`,
    [
      session.id,
      hash,
      session.state_hash,
      session.props ? JSON.stringify(session.props) : null,
      session.last_sent_at,
    ],
  );
}

/**
 * The token is dead: on iOS the activity is gone from the device (the user
 * removed it), so treat it as dismissed in the phase the device last showed.
 * `session` is the snapshot from before this tick's claim: an update claim
 * has already written the new props, and recording *that* phase would
 * suppress the very phase change (e.g. waiting → called) that should bring
 * the activity back.
 */
async function markGone(device: DeviceRow, session: SessionRow): Promise<void> {
  if (device.platform === "android") {
    await forgetDeviceToken(device);
    return;
  }
  await pool.query(
    `UPDATE live_activity_sessions
        SET activity_push_token = NULL, ended_at = COALESCE(ended_at, now()),
            end_reason = 'dismissed', dismissed_phase = COALESCE($2, dismissed_phase),
            state_hash = $3, props = $4
      WHERE id = $1 AND activity_push_token IS NOT DISTINCT FROM $5`,
    [
      session.id,
      session.props?.phase ?? null,
      session.state_hash,
      session.props ? JSON.stringify(session.props) : null,
      session.activity_push_token,
    ],
  );
}

function dueForRotation(ctx: SendContext, device: DeviceRow, session: SessionRow): boolean {
  return (
    device.platform === "ios" &&
    ctx.apns !== null &&
    session.activity_push_token !== null &&
    device.push_to_start_token !== null &&
    // The app in the foreground starts its own; leave the swap to a later tick.
    !ctx.foreground.has(device.id) &&
    ctx.now.getTime() - new Date(session.started_at).getTime() >= IOS_ACTIVITY_ROTATE_MS
  );
}

/**
 * Replaces an iOS activity about to hit ActivityKit's 8-hour limit: ends it
 * with an immediate dismissal, then push-starts the same subject. If the end
 * fails the session stays open and the next tick retries; if the user had
 * already removed it (dead token) it is not started again.
 */
async function rotateSession(
  ctx: SendContext,
  device: DeviceRow,
  session: SessionRow,
  want: Desired,
): Promise<void> {
  if (!(await endSession(ctx, device, session, { dismissNow: true }))) return;
  await startSession(ctx, device, want, {
    ...session,
    activity_push_token: null,
    ended_at: ctx.now,
    end_reason: "finished",
    dismissed_phase: null,
  });
}

/** True when the device was told to end it. */
async function endSession(
  ctx: SendContext,
  device: DeviceRow,
  session: SessionRow,
  options: { dismissNow?: boolean } = {},
): Promise<boolean> {
  if (device.platform === "ios") {
    // Without APNs nothing can reach this activity: keep it open rather than
    // record an end that never happened, so a configured APNs still ends it.
    if (!ctx.apns && session.activity_push_token) return false;
    // No per-activity token yet (a push-to-start the app has not reported,
    // or a local start whose token is pending): the activity is still on
    // the device and only that token can end it. Keep the session open, so
    // the tick after the app reports the token ends it, and a returning
    // subject is updated instead of push-started a second time. Past
    // ActivityKit's lifetime the activity is gone and the row is closed.
    if (
      !session.activity_push_token &&
      ctx.now.getTime() - new Date(session.started_at).getTime() < IOS_ACTIVITY_LIFETIME_MS
    ) {
      return false;
    }
  }
  const { rows } = await pool.query<{ id: number }>(
    `UPDATE live_activity_sessions SET ended_at = now(), end_reason = 'finished'
      WHERE id = $1 AND ended_at IS NULL
      RETURNING id`,
    [session.id],
  );
  if (rows.length === 0) return false;
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
    dismissNow: options.dismissNow,
  });
  if (result === "ok" || result === "skipped") {
    ctx.summary.ended += 1;
    return true;
  }
  if (result === "gone") {
    await markGone(device, session);
    ctx.summary.ended += 1;
    return false;
  }
  ctx.summary.failed += 1;
  await pool.query(
    `UPDATE live_activity_sessions SET ended_at = NULL, end_reason = NULL
      WHERE id = $1 AND end_reason = 'finished'`,
    [session.id],
  );
  return false;
}

registerWorker(LIVE_ACTIVITIES_QUEUE, async (job) => {
  const summary = await runLiveActivitiesTick();
  // Another replica's tick held the lock and may have read the state before
  // the change (or the phase boundary) this job is for: try again shortly
  // rather than wait 20 s.
  if (
    summary.skipped &&
    (job.name === LIVE_ACTIVITIES_KICK_JOB || job.name === LIVE_ACTIVITIES_BOUNDARY_JOB)
  ) {
    await requestLiveActivitySync();
  }
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
