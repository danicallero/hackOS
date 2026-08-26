import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { isImplausiblyFuture } from "../../lib/clock.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcastForActiveUser } from "./active-broadcast.js";
import { resolveByBadge } from "./badge.js";
import { loadPersonCard } from "./cards.js";
import {
  buildCertaintyWindows,
  buildPresenceIntervals,
  DEFAULT_SUSPICIOUS_GAP_MS,
  isPresentAt,
  type PresenceEvent,
  totalPresenceMs,
} from "./estimate.js";

const MS_PER_HOUR = 3_600_000;
// Advisory-lock namespace for presence writes; -1 can't collide with a real
// activityId (see activities.ts's per-(user, activity) lock).
const PRESENCE_LOCK_NS = -1;

/** PostgreSQL timestamps presence signals, so live cutoffs must use its clock too. */
async function databaseNow(client: Queryable = pool): Promise<Date> {
  const { rows } = await client.query(`SELECT clock_timestamp() AS now`);
  return rows[0].now as Date;
}

/**
 * Presence writes must serialize with H54 account closure.  The lock is
 * deliberately on the user row, not just on a badge or advisory key: an
 * offline/stale scanner may have resolved the badge before anonymization
 * started.
 */
async function lockActiveParticipant(client: Queryable, userId: number): Promise<void> {
  const { rows } = await client.query(
    `SELECT id FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("Participant is no longer active");
}

async function certaintyWindowMs(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT presence_certainty_window_minutes FROM event_config WHERE id = 1`,
  );
  return (
    Number(rows[0]?.presence_certainty_window_minutes ?? DEFAULT_SUSPICIOUS_GAP_MS / 60_000) *
    60_000
  );
}

// ── H24: raw session ground truth — never inferred, only closed by a real `out` ──

/**
 * Whether `userId`'s door session is open as of `asOf` (default: now) — i.e.
 * their most recent door scan at or before `asOf` is an `in` with no `out`
 * after it. This is ground truth, not an estimate: it stays true until an
 * `out` is recorded — live, backdated/manual, or the single automatic one the
 * event-end closer inserts at event_ends_at (presence-closer.ts).
 */
async function openSessionAsOf(
  client: Queryable,
  userId: number,
  asOf: Date,
): Promise<{ open: boolean; since: Date | null }> {
  const { rows } = await client.query(
    `SELECT kind, scanned_at FROM time_logs
      WHERE user_id = $1 AND kind IN ('in', 'out') AND scanned_at <= $2
      ORDER BY scanned_at DESC, id DESC LIMIT 1`,
    [userId, asOf],
  );
  const last = rows[0] as { kind: "in" | "out"; scanned_at: Date } | undefined;
  return { open: last?.kind === "in", since: last?.kind === "in" ? last.scanned_at : null };
}

// ── H24: badge lookup — person card + current presence status ─────────────

/**
 * Resolve a scanned badge to the door operator's person card: the estimated
 * likelihood they're currently inside (`present`), plus the raw ground-truth
 * session state (`openSince`) so staff can tell whether an `in` scan will be
 * accepted or needs reconciliation first — mirrors the accreditation lookup
 * UX. Never a mutation.
 */
export async function presenceLookup(badgeId: string) {
  const userId = await resolveByBadge(pool, badgeId);
  const card = await loadPersonCard(pool, userId);
  const events = (await loadEvents(userId)).get(userId) ?? [];
  const now = await databaseNow();
  const session = await openSessionAsOf(pool, userId, now);
  const suspiciousGapMs = await certaintyWindowMs();
  return {
    ...card,
    badgeId,
    present: isPresentAt(events, now.getTime(), { suspiciousGapMs }),
    openSince: session.since?.toISOString() ?? null,
  };
}

// ── H24: door scan (in/out), optional backdated manual entry ──────────────

/**
 * Record a door in/out (H24). `scannedAt` in the past allows a manual
 * backdated entry (e.g. logged after a Wi-Fi outage, or to close a stale
 * session before re-admitting the same person), audited as manual.
 *
 * Enforces the session invariant at write time: an `in` is rejected while a
 * session is already open, and an `out` is rejected when there's nothing
 * open to close. During the event the system never closes a session on its
 * own — if a scan is rejected, staff must first record the missing `out`
 * (backdated if needed) via this same endpoint. The one exception is the
 * event-end closer (presence-closer.ts), which force-closes whatever is
 * still open once event_ends_at passes.
 */
export async function presenceScan(
  actorId: number,
  input: { badgeId: string; kind: "in" | "out"; scannedAt?: Date },
) {
  const userId = await resolveByBadge(pool, input.badgeId);
  const manual = input.scannedAt != null;

  const result = await withTransaction(async (client) => {
    // Serialize concurrent scans for the same person (H24 concurrency).
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [PRESENCE_LOCK_NS, userId]);
    await lockActiveParticipant(client, userId);

    // Resolve live scan time after taking the lock. clock_timestamp(), unlike
    // transaction-stable now(), cannot predate a scan whose transaction just
    // released the same lock.
    const dbNow = await databaseNow(client);
    const scannedAt = input.scannedAt ?? dbNow;
    if (manual && isImplausiblyFuture(scannedAt, dbNow.getTime())) {
      throw new BadRequestError("Backdated scan must be in the past");
    }

    if (input.kind === "in") {
      // A real earlier door scan supersedes an accreditation-created future
      // entry, avoiding two consecutive `in` signals for the same person.
      await client.query(
        `DELETE FROM time_logs
          WHERE user_id = $1 AND scanned_at > $2
            AND notes = 'Automatic entry from accreditation'`,
        [userId, scannedAt],
      );
    }

    const session = await openSessionAsOf(client, userId, scannedAt);
    if (input.kind === "in" && session.open) {
      throw new ConflictError(
        "This person already has an open presence session; close it with a manual exit before recording a new entry.",
        { userId, openSince: session.since?.toISOString() ?? null },
      );
    }
    if (input.kind === "out" && !session.open) {
      throw new ConflictError("This person has no open presence session to close.", { userId });
    }

    const r = await client.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by)
       VALUES ($1, $2, $3, $4) RETURNING id, scanned_at`,
      [userId, input.kind, scannedAt, actorId],
    );
    if (manual) {
      await audit(client, {
        actorId,
        entityType: "presence",
        entityId: userId,
        action: "manual_time_log",
        after: { kind: input.kind, scannedAt },
        source: "admin",
      });
    }
    return {
      logged: true,
      timeLogId: r.rows[0].id,
      userId,
      kind: input.kind,
      scannedAt: r.rows[0].scanned_at,
      manual,
    };
  });
  await broadcastForActiveUser(
    result.userId,
    SSE_TOPICS.LOGISTICS,
    EVENTS.LOGISTICS_PRESENCE_SCAN,
    result,
  );
  return result;
}

// ── H24: staff reconciliation — open sessions with no recent signal ───────

/**
 * Everyone with a currently open door session (an `in` with no `out` yet),
 * newest-signal-last so staff can find the ones that have gone quiet. `stale`
 * flags sessions with no supporting signal (door or activity) for longer
 * than the suspicious-gap window — i.e. the system's estimate no longer
 * finds it plausible the person is still on site — but the session stays
 * genuinely open until staff record a real `out`, or until the event-end
 * closer force-closes it at event_ends_at (presence-closer.ts).
 */
export async function openSessions(at?: number) {
  const now = at ?? (await databaseNow()).getTime();
  const windowMs = await certaintyWindowMs();
  const { rows } = await pool.query(
    `SELECT tl.user_id, tl.scanned_at AS since, u.name, u.surname,
            GREATEST(tl.scanned_at, COALESCE(la.last_activity, tl.scanned_at)) AS last_signal
       FROM (
         SELECT DISTINCT ON (user_id) user_id, kind, scanned_at
           FROM time_logs
      WHERE scanned_at <= now() AND kind IN ('in', 'out')
          ORDER BY user_id, scanned_at DESC, id DESC
       ) tl
       JOIN users u ON u.id = tl.user_id
       LEFT JOIN LATERAL (
         SELECT max(logged_at) AS last_activity FROM activity_logs
          WHERE user_id = tl.user_id AND logged_at >= tl.scanned_at
       ) la ON true
      WHERE tl.kind = 'in'
        AND u.account_state = 'active'
        AND u.anonymized_at IS NULL
      ORDER BY last_signal ASC`,
  );
  return (
    rows as {
      user_id: number;
      since: Date;
      name: string | null;
      surname: string | null;
      last_signal: Date;
    }[]
  ).map((r) => {
    const staleMs = now - r.last_signal.getTime();
    return {
      userId: r.user_id,
      name: r.name,
      surname: r.surname,
      since: r.since.toISOString(),
      lastSignal: r.last_signal.toISOString(),
      stale: staleMs > windowMs,
    };
  });
}

// ── presence estimation reads (H24) ───────────────────────────────────────

/**
 * Load raw presence signals (door in/out + activity scans) grouped per user.
 * Passing a userId scopes to that user.
 */
async function loadEvents(userId?: number): Promise<Map<number, PresenceEvent[]>> {
  const scoped = userId != null;
  const timeFilter = scoped
    ? `WHERE tl.user_id = $1
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = tl.user_id
          AND u.account_state = 'active' AND u.anonymized_at IS NULL)`
    : `WHERE tl.user_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = tl.user_id
          AND u.account_state = 'active' AND u.anonymized_at IS NULL)`;
  const activityFilter = scoped
    ? `WHERE al.user_id = $1
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = al.user_id
          AND u.account_state = 'active' AND u.anonymized_at IS NULL)`
    : `WHERE al.user_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = al.user_id
          AND u.account_state = 'active' AND u.anonymized_at IS NULL)`;
  const params = scoped ? [userId] : [];
  const { rows } = await pool.query(
    `SELECT tl.user_id, extract(epoch from tl.scanned_at) * 1000 AS t, tl.kind
       FROM time_logs tl ${timeFilter} AND tl.kind IN ('in', 'out')
     UNION ALL
     SELECT al.user_id, extract(epoch from al.logged_at) * 1000 AS t, 'activity' AS kind
       FROM activity_logs al ${activityFilter}`,
    params,
  );

  const map = new Map<number, PresenceEvent[]>();
  for (const row of rows as { user_id: number; t: string; kind: PresenceEvent["kind"] }[]) {
    const arr = map.get(row.user_id) ?? [];
    arr.push({ t: Number(row.t), kind: row.kind });
    map.set(row.user_id, arr);
  }
  return map;
}

/** H24/H27: how many people are estimated to be in the venue right now. */
export async function occupancyEstimate(cutoff?: number) {
  const at = cutoff ?? (await databaseNow()).getTime();
  const map = await loadEvents();
  const suspiciousGapMs = await certaintyWindowMs();
  const present: number[] = [];
  for (const [userId, events] of map) {
    if (isPresentAt(events, at, { suspiciousGapMs })) present.push(userId);
  }
  present.sort((a, b) => a - b);
  return { at: new Date(at).toISOString(), presentCount: present.length, present };
}

/** H24: estimated attendance hours for one user (e.g. university-credit minimum). */
export async function userHours(userId: number, cutoff?: number) {
  const now = cutoff ?? (await databaseNow()).getTime();
  const events = (await loadEvents(userId)).get(userId) ?? [];
  const suspiciousGapMs = await certaintyWindowMs();
  const intervals = buildPresenceIntervals(events, now, { suspiciousGapMs });
  return {
    userId,
    hours: round2(totalPresenceMs(events, now, { suspiciousGapMs }) / MS_PER_HOUR),
    intervals: intervals.map((i) => ({
      start: new Date(i.start).toISOString(),
      end: new Date(i.end).toISOString(),
      confirmed: i.confirmed,
    })),
  };
}

/** H24: estimated hours for every user with presence signals (bulk, admin display). */
export async function allHours(cutoff?: number) {
  const now = cutoff ?? (await databaseNow()).getTime();
  const map = await loadEvents();
  const suspiciousGapMs = await certaintyWindowMs();
  const userIds = [...map.keys()];
  if (userIds.length === 0) return [];

  const { rows: people } = await pool.query(
    `SELECT id, name, surname FROM users
      WHERE id = ANY($1) AND account_state = 'active' AND anonymized_at IS NULL`,
    [userIds],
  );
  const nameById = new Map(
    (people as { id: number; name: string | null; surname: string | null }[]).map((p) => [
      p.id,
      { name: p.name, surname: p.surname },
    ]),
  );

  return userIds
    .map((userId) => {
      const events = map.get(userId) ?? [];
      return {
        userId,
        name: nameById.get(userId)?.name ?? null,
        surname: nameById.get(userId)?.surname ?? null,
        hours: round2(totalPresenceMs(events, now, { suspiciousGapMs }) / MS_PER_HOUR),
      };
    })
    .sort((a, b) => a.userId - b.userId);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── raw scan admin — view/correct individual time_logs (H24 usability) ─────

/** List every raw door scan for a user, oldest first, for admin review/edit. */
export async function listTimeLogs(userId: number) {
  const { rows } = await pool.query(
    `SELECT tl.id, tl.kind, tl.scanned_at, tl.scanned_by, tl.notes,
            u.name AS scanned_by_name, u.surname AS scanned_by_surname
       FROM time_logs tl
       LEFT JOIN users u ON u.id = tl.scanned_by
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
      WHERE tl.user_id = $1
        AND EXISTS (SELECT 1 FROM users subject
                     WHERE subject.id = tl.user_id
                       AND subject.account_state = 'active'
                       AND subject.anonymized_at IS NULL)
      ORDER BY tl.scanned_at ASC, tl.id ASC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id as number,
    kind: r.kind as "in" | "out",
    scannedAt: (r.scanned_at as Date).toISOString(),
    notes: (r.notes as string | null) ?? null,
    // scanned_by NULL = system-generated log (event-end auto exit, 0708)
    scannedBy:
      r.scanned_by == null
        ? null
        : {
            userId: r.scanned_by as number,
            name: (r.scanned_by_name as string | null) ?? null,
            surname: (r.scanned_by_surname as string | null) ?? null,
          },
  }));
}

/** Correct a wrong door scan (H24): admin fixes kind/time on an existing time_log. */
export async function updateTimeLog(
  actorId: number,
  id: number,
  input: { kind?: "in" | "out"; scannedAt?: Date; notes?: string | null },
) {
  if (input.scannedAt != null && isImplausiblyFuture(input.scannedAt)) {
    throw new BadRequestError("Scan time must be in the past");
  }

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, kind, scanned_at, notes FROM time_logs WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = rows[0];
    if (!before) throw new NotFoundError("Time log not found");
    if (before.user_id == null) throw new NotFoundError("Time log participant is no longer active");
    await lockActiveParticipant(client, before.user_id as number);

    const kind = input.kind ?? before.kind;
    const scannedAt = input.scannedAt ?? before.scanned_at;
    const notes = input.notes === undefined ? before.notes : input.notes;

    const { rows: updated } = await client.query(
      `UPDATE time_logs SET kind = $1, scanned_at = $2, notes = $3
        WHERE id = $4 RETURNING id, user_id, kind, scanned_at, notes`,
      [kind, scannedAt, notes, id],
    );

    await audit(client, {
      actorId,
      entityType: "presence",
      entityId: before.user_id,
      action: "edit_time_log",
      before: {
        id,
        kind: before.kind,
        scannedAt: before.scanned_at,
      },
      after: { id, kind, scannedAt, notes },
      source: "admin",
    });

    return updated[0];
  });

  await broadcastForActiveUser(
    result.user_id as number,
    SSE_TOPICS.LOGISTICS,
    EVENTS.LOGISTICS_PRESENCE_SCAN,
    {
      edited: true,
      timeLogId: result.id,
      userId: result.user_id,
    },
  );
  return {
    id: result.id as number,
    userId: result.user_id as number,
    kind: result.kind as "in" | "out",
    scannedAt: (result.scanned_at as Date).toISOString(),
    notes: (result.notes as string | null) ?? null,
  };
}

export async function createPresenceSignal(
  actorId: number,
  userId: number,
  input:
    | { kind: "in" | "out"; occurredAt: Date; notes?: string | null }
    | { kind: "activity"; occurredAt: Date; activityId: number; notes?: string | null },
) {
  if (input.occurredAt.getTime() > Date.now()) {
    throw new BadRequestError("Presence signals cannot be in the future");
  }
  const result = await withTransaction(async (client) => {
    await lockActiveParticipant(client, userId);
    if (input.kind === "activity") {
      const activity = await client.query(`SELECT id FROM activities WHERE id = $1`, [
        input.activityId,
      ]);
      if (!activity.rows[0]) throw new NotFoundError("Activity not found");
      const { rows } = await client.query(
        `INSERT INTO activity_logs (user_id, activity_id, notes, logged_at, logged_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, logged_at`,
        [userId, input.activityId, input.notes ?? null, input.occurredAt, actorId],
      );
      await audit(client, {
        actorId,
        entityType: "presence_activity",
        entityId: rows[0].id,
        action: "manual_create",
        after: { userId, activityId: input.activityId, occurredAt: input.occurredAt },
        source: "admin",
      });
      return { source: "activity" as const, id: rows[0].id as number };
    }
    const { rows } = await client.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, input.kind, input.occurredAt, actorId, input.notes ?? null],
    );
    await audit(client, {
      actorId,
      entityType: "presence",
      entityId: userId,
      action: "manual_time_log",
      after: { id: rows[0].id, kind: input.kind, occurredAt: input.occurredAt },
      source: "admin",
    });
    return { source: "door" as const, id: rows[0].id as number };
  });
  await broadcastForActiveUser(userId, SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_PRESENCE_SCAN, {
    created: true,
    userId,
    ...result,
  });
  return result;
}

export async function updatePresenceActivity(
  actorId: number,
  id: number,
  input: { activityId?: number; occurredAt?: Date; notes?: string | null },
) {
  if (input.occurredAt && input.occurredAt.getTime() > Date.now()) {
    throw new BadRequestError("Presence signals cannot be in the future");
  }
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, activity_id, logged_at, notes FROM activity_logs WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = rows[0];
    if (!before) throw new NotFoundError("Activity log not found");
    if (before.user_id == null)
      throw new NotFoundError("Activity log participant is no longer active");
    await lockActiveParticipant(client, before.user_id as number);
    const activityId = input.activityId ?? before.activity_id;
    const exists = await client.query(`SELECT 1 FROM activities WHERE id = $1`, [activityId]);
    if (!exists.rows[0]) throw new NotFoundError("Activity not found");
    const { rows: updated } = await client.query(
      `UPDATE activity_logs
          SET activity_id = $1, logged_at = $2, notes = $3
        WHERE id = $4 RETURNING id, user_id`,
      [
        activityId,
        input.occurredAt ?? before.logged_at,
        input.notes === undefined ? before.notes : input.notes,
        id,
      ],
    );
    await audit(client, {
      actorId,
      entityType: "presence_activity",
      entityId: id,
      action: "manual_update",
      before,
      after: input,
      source: "admin",
    });
    return updated[0] as { id: number; user_id: number };
  });
  await broadcastForActiveUser(
    result.user_id,
    SSE_TOPICS.LOGISTICS,
    EVENTS.LOGISTICS_ACTIVITY_SCAN,
    {
      edited: true,
      activityLogId: result.id,
      userId: result.user_id,
    },
  );
  return { id: result.id, userId: result.user_id };
}

export async function deletePresenceActivity(actorId: number, id: number) {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, activity_id, logged_at, notes FROM activity_logs WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = rows[0];
    if (!before) throw new NotFoundError("Activity log not found");
    if (before.user_id == null)
      throw new NotFoundError("Activity log participant is no longer active");
    await lockActiveParticipant(client, before.user_id as number);
    await client.query(`DELETE FROM activity_logs WHERE id = $1`, [id]);
    await audit(client, {
      actorId,
      entityType: "presence_activity",
      entityId: id,
      action: "manual_delete",
      before,
      source: "admin",
    });
    return { id, userId: before.user_id as number };
  });
  await broadcastForActiveUser(
    result.userId,
    SSE_TOPICS.LOGISTICS,
    EVENTS.LOGISTICS_ACTIVITY_SCAN,
    {
      deleted: true,
      activityLogId: id,
      userId: result.userId,
    },
  );
  return { deleted: true as const };
}

export async function presenceTimeline(userId: number, cutoff?: number) {
  const now = cutoff ?? (await databaseNow()).getTime();
  const suspiciousGapMs = await certaintyWindowMs();
  const [{ rows }, { rows: activityRows }] = await Promise.all([
    pool.query(
      `SELECT tl.id, 'door' AS source, tl.kind, tl.scanned_at AS occurred_at,
            NULL::integer AS activity_id, NULL::text AS activity_name,
            NULL::text AS category, tl.notes, tl.scanned_by AS recorded_by,
            u.name AS recorded_by_name, u.surname AS recorded_by_surname
       FROM time_logs tl
       LEFT JOIN users u ON u.id = tl.scanned_by
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
      WHERE tl.user_id = $1
        AND EXISTS (SELECT 1 FROM users subject
                     WHERE subject.id = tl.user_id
                       AND subject.account_state = 'active'
                       AND subject.anonymized_at IS NULL)
     UNION ALL
     SELECT al.id, 'activity', 'activity', al.logged_at, a.id, a.name, a.category,
            al.notes, al.logged_by, u.name, u.surname
       FROM activity_logs al
       JOIN activities a ON a.id = al.activity_id
       LEFT JOIN users u ON u.id = al.logged_by
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
      WHERE al.user_id = $1
        AND EXISTS (SELECT 1 FROM users subject
                     WHERE subject.id = al.user_id
                       AND subject.account_state = 'active'
                       AND subject.anonymized_at IS NULL)
     ORDER BY occurred_at ASC, id ASC`,
      [userId],
    ),
    // Only activities an operator could have scanned (H25 meals + H26
    // `requires_scan`) are offerable as a manual activity signal — the same
    // set as /api/activities/scannable. Anything this person already has a
    // log against stays listed regardless, so editing an existing signal
    // never loses its own activity from the picker.
    pool.query(
      `SELECT a.id, a.name, a.category
         FROM activities a
         LEFT JOIN schedule s ON s.id = a.schedule_id
        WHERE a.category = ANY($2::text[])
           OR a.requires_scan = true
           OR EXISTS (SELECT 1 FROM activity_logs al
                       WHERE al.activity_id = a.id AND al.user_id = $1)
        ORDER BY s.starts_at ASC NULLS LAST, a.name ASC, a.id ASC`,
      [userId, [...MEAL_ACTIVITY_KINDS]],
    ),
  ]);
  const signals = rows.map((row) => ({
    id: Number(row.id),
    source: row.source as "door" | "activity",
    kind: row.kind as PresenceEvent["kind"],
    occurredAt: (row.occurred_at as Date).toISOString(),
    activityId: row.activity_id == null ? null : Number(row.activity_id),
    activityName: (row.activity_name as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    // recorded_by NULL = system-generated log (event-end auto exit, 0708)
    recordedBy:
      row.recorded_by == null
        ? null
        : {
            userId: Number(row.recorded_by),
            name: (row.recorded_by_name as string | null) ?? null,
            surname: (row.recorded_by_surname as string | null) ?? null,
          },
  }));
  const events = signals.map((signal) => ({
    t: Date.parse(signal.occurredAt),
    kind: signal.kind,
  }));
  // Illegal in→in (H24): two door entries with no exit/activity between them.
  // Only reachable through manual log edits — presenceScan rejects it live.
  // The bounds let the client constrain the fix strictly between both scans.
  const conflicts: Array<{
    firstLogId: number;
    secondLogId: number;
    from: string;
    to: string;
  }> = [];
  for (let i = 1; i < signals.length; i++) {
    const prev = signals[i - 1];
    const curr = signals[i];
    if (prev && curr && prev.kind === "in" && curr.kind === "in") {
      conflicts.push({
        firstLogId: prev.id,
        secondLogId: curr.id,
        from: prev.occurredAt,
        to: curr.occurredAt,
      });
    }
  }
  return {
    certaintyWindowMinutes: suspiciousGapMs / 60_000,
    activities: activityRows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      category: String(row.category),
    })),
    signals,
    conflicts,
    windows: buildCertaintyWindows(events, now, { suspiciousGapMs }).map((window) => ({
      ...window,
      start: new Date(window.start).toISOString(),
      deadline: new Date(window.deadline).toISOString(),
      securedUntil:
        window.securedUntil == null ? null : new Date(window.securedUntil).toISOString(),
    })),
  };
}

/** Remove a bad door scan (H24): e.g. a mis-scanned badge or duplicate entry. */
export async function deleteTimeLog(actorId: number, id: number) {
  const userId = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, kind, scanned_at FROM time_logs WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = rows[0];
    if (!before) throw new NotFoundError("Time log not found");
    if (before.user_id == null) throw new NotFoundError("Time log participant is no longer active");
    await lockActiveParticipant(client, before.user_id as number);

    await client.query(`DELETE FROM time_logs WHERE id = $1`, [id]);

    await audit(client, {
      actorId,
      entityType: "presence",
      entityId: before.user_id,
      action: "delete_time_log",
      before: {
        id,
        kind: before.kind,
        scannedAt: before.scanned_at,
      },
      source: "admin",
    });

    return before.user_id as number;
  });

  await broadcastForActiveUser(userId, SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_PRESENCE_SCAN, {
    deleted: true,
    timeLogId: id,
    userId,
  });
  return { deleted: true as const };
}
