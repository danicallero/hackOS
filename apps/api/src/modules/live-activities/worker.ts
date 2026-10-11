import type {
  AndroidLiveUpdateMessage,
  LiveActivityKind,
  LiveActivityProps,
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
  relevanceForRank,
  selectForDevice,
} from "./candidates.js";
import { liveStateHash } from "./state.js";

/**
 * Live Activity push worker (#966; H38, H25, H26, H59, H19, H29-H36, H22).
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
 *   are throttled to one per 30 s per session; queue and judging changes and
 *   phase changes go out immediately);
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

export const LIVE_ACTIVITIES_QUEUE = "live-activities";
const TICK_EVERY_MS = 20_000;
const ACTIVITY_UPDATE_THROTTLE_SECONDS = 30;
/** Arbitrary constant for pg_try_advisory_lock; unique among this codebase's advisory keys. */
const TICK_LOCK_KEY = 966_001;
/**
 * Without an update for this long, iOS greys a queue or judging activity
 * out as stale (both have no natural end instant).
 */
const OPEN_ENDED_STALE_MS = 30 * 60 * 1000;
/**
 * An unchanged queue or judging state is re-sent after this long, so a team
 * waiting (or a long pitch) without any visible change is not greyed out.
 */
const OPEN_ENDED_REFRESH_MS = OPEN_ENDED_STALE_MS / 2;
/** Kinds whose every change goes out immediately (no counter throttle). */
const URGENT_KINDS = new Set<LiveActivityKind>(["queue", "judging"]);
const OPEN_ENDED_KINDS = new Set<LiveActivityKind>(["queue", "judging"]);

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
    case "judging": {
      const { labels } = props;
      const body = props.current
        ? `${props.phase === "presenting" ? labels.presenting : labels.inRoom}: ${props.current.name}`
        : props.next
          ? `${labels.next}: ${props.next.name}`
          : labels.noTeam;
      return { title: props.roomName, body };
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

/** The one update that alerts, if this transition is it. */
function updateAlert(props: LiveActivityProps, previousPhase: string | null): boolean {
  if (props.kind === "queue") return props.phase === "called" && previousPhase !== "called";
  if (props.kind === "deadline") return props.phase === "closing" && previousPhase !== "closing";
  return false;
}

function staleDateFor(props: LiveActivityProps, now: Date): Date {
  switch (props.kind) {
    case "activity":
    case "attendee_activity":
    case "deadline":
    case "accreditation":
      return new Date(props.endsAt);
    default:
      return new Date(now.getTime() + OPEN_ENDED_STALE_MS);
  }
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
            ended_at, end_reason, dismissed_phase
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
  const sendCtx: SendContext = { apns, android, now, timezone, summary };

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
        const key = sessionKey(device.id, want.kind, want.subject);
        desiredKeys.add(key);
        const session = sessions.get(key);
        if (!session || session.end_reason === "finished") {
          await startSession(sendCtx, device, want, session);
        } else if (session.ended_at === null) {
          await updateSession(sendCtx, device, session, want);
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
        staleDate: input.event === "end" ? undefined : staleDateFor(input.props, ctx.now),
        relevanceScore: relevanceForRank(input.props.rank),
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
  const urgent = URGENT_KINDS.has(want.kind) || phaseChanged;
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
    priority: alerting || phaseChanged ? 10 : 5,
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

async function endSession(ctx: SendContext, device: DeviceRow, session: SessionRow): Promise<void> {
  // Without APNs nothing can reach this activity: keep it open rather than
  // record an end that never happened, so a configured APNs still ends it.
  if (device.platform === "ios" && !ctx.apns && session.activity_push_token) return;
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
