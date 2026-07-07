import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError } from "../../lib/errors.js";
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
    })),
  };
}

/** H24: estimated hours for every user with presence signals (bulk). */
export async function allHours(now: number = Date.now()) {
  const map = await loadEvents();
  return [...map.entries()]
    .map(([userId, events]) => ({
      userId,
      hours: round2(totalPresenceMs(events, now) / MS_PER_HOUR),
    }))
    .sort((a, b) => a.userId - b.userId);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
