import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { resolveByBadge } from "./badge.js";
import { loadPersonCard } from "./cards.js";
import {
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

// ── H24: raw session ground truth — never inferred, only closed by a real `out` ──

/**
 * Whether `userId`'s door session is open as of `asOf` (default: now) — i.e.
 * their most recent door scan at or before `asOf` is an `in` with no `out`
 * after it. This is ground truth, not an estimate: the system never closes a
 * session itself, so this stays true until a real `out` (live or
 * backdated/manual) is recorded.
 */
async function openSessionAsOf(
  client: Queryable,
  userId: number,
  asOf: Date,
): Promise<{ open: boolean; since: Date | null }> {
  const { rows } = await client.query(
    `SELECT kind, scanned_at FROM time_logs
      WHERE user_id = $1 AND scanned_at <= $2
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
  const session = await openSessionAsOf(pool, userId, new Date());
  return {
    ...card,
    badgeId,
    present: isPresentAt(events, Date.now()),
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
 * open to close. The system never closes a session on its own — if a scan
 * is rejected, staff must first record the missing `out` (backdated if
 * needed) via this same endpoint.
 */
export async function presenceScan(
  actorId: number,
  input: { badgeId: string; kind: "in" | "out"; scannedAt?: Date },
) {
  const userId = await resolveByBadge(pool, input.badgeId);
  const manual = input.scannedAt != null;
  const scannedAt = input.scannedAt ?? new Date();
  if (manual && scannedAt.getTime() > Date.now()) {
    throw new BadRequestError("Backdated scan must be in the past");
  }

  const result = await withTransaction(async (client) => {
    // Serialize concurrent scans for the same person (H24 concurrency).
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [PRESENCE_LOCK_NS, userId]);

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
  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_PRESENCE_SCAN, result);
  return result;
}

// ── H24: staff reconciliation — open sessions with no recent signal ───────

/**
 * Everyone with a currently open door session (an `in` with no `out` yet),
 * newest-signal-last so staff can find the ones that have gone quiet. `stale`
 * flags sessions with no supporting signal (door or activity) for longer
 * than the suspicious-gap window — i.e. the system's estimate no longer
 * finds it plausible the person is still on site — but the session stays
 * genuinely open until staff record a real `out`. The system never closes
 * these itself.
 */
export async function openSessions(now: number = Date.now()) {
  const { rows } = await pool.query(
    `SELECT tl.user_id, tl.scanned_at AS since, u.name, u.surname,
            GREATEST(tl.scanned_at, COALESCE(la.last_activity, tl.scanned_at)) AS last_signal
       FROM (
         SELECT DISTINCT ON (user_id) user_id, kind, scanned_at
           FROM time_logs
          ORDER BY user_id, scanned_at DESC, id DESC
       ) tl
       JOIN users u ON u.id = tl.user_id
       LEFT JOIN LATERAL (
         SELECT max(logged_at) AS last_activity FROM activity_logs
          WHERE user_id = tl.user_id AND logged_at >= tl.scanned_at
       ) la ON true
      WHERE tl.kind = 'in'
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
      stale: staleMs > DEFAULT_SUSPICIOUS_GAP_MS,
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
  const filter = scoped ? "WHERE user_id = $1" : "";
  const params = scoped ? [userId] : [];
  const { rows } = await pool.query(
    `SELECT user_id, extract(epoch from scanned_at) * 1000 AS t, kind FROM time_logs ${filter}
     UNION ALL
     SELECT user_id, extract(epoch from logged_at) * 1000 AS t, 'activity' AS kind
       FROM activity_logs ${filter}`,
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
export async function occupancyEstimate(at: number = Date.now()) {
  const map = await loadEvents();
  const present: number[] = [];
  for (const [userId, events] of map) {
    if (isPresentAt(events, at)) present.push(userId);
  }
  present.sort((a, b) => a - b);
  return { at: new Date(at).toISOString(), presentCount: present.length, present };
}

/** H24: estimated attendance hours for one user (e.g. university-credit minimum). */
export async function userHours(userId: number, now: number = Date.now()) {
  const events = (await loadEvents(userId)).get(userId) ?? [];
  const intervals = buildPresenceIntervals(events, now);
  return {
    userId,
    hours: round2(totalPresenceMs(events, now) / MS_PER_HOUR),
    intervals: intervals.map((i) => ({
      start: new Date(i.start).toISOString(),
      end: new Date(i.end).toISOString(),
      confirmed: i.confirmed,
    })),
  };
}

/** H24: estimated hours for every user with presence signals (bulk, admin display). */
export async function allHours(now: number = Date.now()) {
  const map = await loadEvents();
  const userIds = [...map.keys()];
  if (userIds.length === 0) return [];

  const { rows: people } = await pool.query(
    `SELECT id, name, surname FROM users WHERE id = ANY($1)`,
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
        hours: round2(totalPresenceMs(events, now) / MS_PER_HOUR),
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
    `SELECT tl.id, tl.kind, tl.scanned_at, tl.scanned_by,
            u.name AS scanned_by_name, u.surname AS scanned_by_surname
       FROM time_logs tl
       JOIN users u ON u.id = tl.scanned_by
      WHERE tl.user_id = $1
      ORDER BY tl.scanned_at ASC, tl.id ASC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id as number,
    kind: r.kind as "in" | "out",
    scannedAt: (r.scanned_at as Date).toISOString(),
    scannedBy: {
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
  input: { kind?: "in" | "out"; scannedAt?: Date },
) {
  if (input.scannedAt != null && input.scannedAt.getTime() > Date.now()) {
    throw new BadRequestError("Scan time must be in the past");
  }

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, kind, scanned_at FROM time_logs WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = rows[0];
    if (!before) throw new NotFoundError("Time log not found");

    const kind = input.kind ?? before.kind;
    const scannedAt = input.scannedAt ?? before.scanned_at;

    const { rows: updated } = await client.query(
      `UPDATE time_logs SET kind = $1, scanned_at = $2
        WHERE id = $3 RETURNING id, user_id, kind, scanned_at`,
      [kind, scannedAt, id],
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
      after: { id, kind, scannedAt },
      source: "admin",
    });

    return updated[0];
  });

  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_PRESENCE_SCAN, {
    edited: true,
    timeLogId: result.id,
    userId: result.user_id,
  });
  return {
    id: result.id as number,
    userId: result.user_id as number,
    kind: result.kind as "in" | "out",
    scannedAt: (result.scanned_at as Date).toISOString(),
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

  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_PRESENCE_SCAN, {
    deleted: true,
    timeLogId: id,
    userId,
  });
  return { deleted: true as const };
}
