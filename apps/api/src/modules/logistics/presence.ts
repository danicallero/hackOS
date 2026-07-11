import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { resolveByBadge } from "./badge.js";
import {
  buildPresenceIntervals,
  isPresentAt,
  type PresenceEvent,
  totalPresenceMs,
} from "./estimate.js";

const MS_PER_HOUR = 3_600_000;

// ── H24: door scan (in/out), optional backdated manual entry ──────────────

/**
 * Record a door in/out (H24). `scannedAt` in the past allows a manual
 * backdated entry (e.g. logged after a Wi-Fi outage), audited as manual.
 */
export async function presenceScan(
  actorId: number,
  input: { badgeId: string; kind: "in" | "out"; location?: string; scannedAt?: Date },
) {
  const userId = await resolveByBadge(pool, input.badgeId);
  const manual = input.scannedAt != null;
  if (manual && (input.scannedAt as Date).getTime() > Date.now()) {
    throw new BadRequestError("Backdated scan must be in the past");
  }

  const result = await withTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by, location)
       VALUES ($1, $2, COALESCE($3, now()), $4, $5) RETURNING id, scanned_at`,
      [userId, input.kind, input.scannedAt ?? null, actorId, input.location ?? null],
    );
    if (manual) {
      await audit(client, {
        actorId,
        entityType: "presence",
        entityId: userId,
        action: "manual_time_log",
        after: { kind: input.kind, scannedAt: input.scannedAt, location: input.location ?? null },
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
    `SELECT tl.id, tl.kind, tl.scanned_at, tl.location, tl.scanned_by,
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
    location: (r.location as string | null) ?? null,
    scannedBy: {
      userId: r.scanned_by as number,
      name: (r.scanned_by_name as string | null) ?? null,
      surname: (r.scanned_by_surname as string | null) ?? null,
    },
  }));
}

/** Correct a wrong door scan (H24): admin fixes kind/time/location on an existing time_log. */
export async function updateTimeLog(
  actorId: number,
  id: number,
  input: { kind?: "in" | "out"; scannedAt?: Date; location?: string | null },
) {
  if (input.scannedAt != null && input.scannedAt.getTime() > Date.now()) {
    throw new BadRequestError("Scan time must be in the past");
  }

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, kind, scanned_at, location FROM time_logs WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = rows[0];
    if (!before) throw new NotFoundError("Time log not found");

    const kind = input.kind ?? before.kind;
    const scannedAt = input.scannedAt ?? before.scanned_at;
    const location = input.location !== undefined ? input.location : before.location;

    const { rows: updated } = await client.query(
      `UPDATE time_logs SET kind = $1, scanned_at = $2, location = $3
        WHERE id = $4 RETURNING id, user_id, kind, scanned_at, location`,
      [kind, scannedAt, location, id],
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
        location: before.location,
      },
      after: { id, kind, scannedAt, location },
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
    location: (result.location as string | null) ?? null,
  };
}

/** Remove a bad door scan (H24): e.g. a mis-scanned badge or duplicate entry. */
export async function deleteTimeLog(actorId: number, id: number) {
  const userId = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, kind, scanned_at, location FROM time_logs WHERE id = $1 FOR UPDATE`,
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
        location: before.location,
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
