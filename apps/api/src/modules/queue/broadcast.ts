import { SSE_TOPICS, type SseEnvelope } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { broadcast } from "../../lib/sse.js";
import {
  type FixtureRoomScope,
  inspectFixtureRoomScope,
  inspectFixtureRoomScopes,
} from "../logistics/review-fixture-scope.js";
import { queueGroupFixtureMarker } from "./fixture-scope.js";

/** Queue resources whose marker determines the operator SSE topic. */
export type QueueBroadcastResource = "challenge" | "entry" | "queueGroup" | "room";

export function queueTopicForFixture(isSynthetic: boolean): string {
  return isSynthetic ? SSE_TOPICS.QUEUE_FIXTURE : SSE_TOPICS.QUEUE;
}

/**
 * Resolve the review-fixture marker from the same graph that produced the
 * queue event. Mixed or missing graphs fail closed: an identity-bearing
 * payload must never fall back to the real operator topic.
 */
export async function queueFixtureMarker(
  db: Queryable,
  resource: QueueBroadcastResource,
  resourceId: number,
): Promise<boolean | null> {
  if (resource === "challenge") {
    const { rows } = await db.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM challenges WHERE id = $1`,
      [resourceId],
    );
    return rows[0] ? rows[0].is_test_account === true : null;
  }

  if (resource === "entry") {
    const row = (await fetchEntryMarkerRows(db, [resourceId])).get(resourceId);
    const marker = entryMarkerPrecheck(row);
    if (marker === null || !row) return null;
    if ((await groupMarkerOrNull(db, Number(row.queue_group_id))) !== marker) return null;
    if (row.assigned_room_id != null) {
      const roomMarker = await queueFixtureMarker(db, "room", Number(row.assigned_room_id));
      if (roomMarker !== marker) return null;
    }
    return marker;
  }

  if (resource === "queueGroup") {
    try {
      return await queueGroupFixtureMarker(db, resourceId);
    } catch {
      return null;
    }
  }

  return roomMarkerFromScope(await inspectFixtureRoomScope(db, resourceId));
}

type EntryMarkerRow = {
  id: number;
  challenge_is_test_account: boolean;
  repo_is_test_account: boolean;
  queue_group_id: number | null;
  assigned_room_id: number | null;
};

/** First row per entry id, mirroring the single-entry `rows[0]` read. */
async function fetchEntryMarkerRows(
  db: Queryable,
  entryIds: readonly number[],
): Promise<Map<number, EntryMarkerRow>> {
  const { rows } = await db.query<EntryMarkerRow>(
    `SELECT qe.id,
            c.is_test_account AS challenge_is_test_account,
            r.is_test_account AS repo_is_test_account,
            qgc.queue_group_id,
            qe.assigned_room_id
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN repos r ON r.id = qe.repo_id
       LEFT JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
      WHERE qe.id = ANY($1::int[])`,
    [entryIds],
  );
  const byId = new Map<number, EntryMarkerRow>();
  for (const row of rows) if (!byId.has(Number(row.id))) byId.set(Number(row.id), row);
  return byId;
}

/**
 * Pure part of the entry rule shared by the single and batch resolvers: the
 * entry's own marker, or null when the row is missing, challenge and repo
 * disagree, or no queue group exists (no safe operator topic).
 */
function entryMarkerPrecheck(row: EntryMarkerRow | undefined): boolean | null {
  if (!row || row.challenge_is_test_account !== row.repo_is_test_account) return null;
  if (row.queue_group_id == null) return null;
  return row.challenge_is_test_account === true;
}

async function groupMarkerOrNull(db: Queryable, queueGroupId: number): Promise<boolean | null> {
  try {
    return await queueGroupFixtureMarker(db, queueGroupId);
  } catch {
    return null;
  }
}

/**
 * Set-based `queueFixtureMarker(db, "entry", id)` with identical fail-closed
 * semantics: one query for the entries, one marker resolution per distinct
 * queue group, and one batch lookup for assigned rooms. Every requested id is
 * present in the result.
 */
export async function queueEntryFixtureMarkers(
  db: Queryable,
  entryIds: readonly number[],
): Promise<Map<number, boolean | null>> {
  const result = new Map<number, boolean | null>();
  if (entryIds.length === 0) return result;
  const rows = await fetchEntryMarkerRows(db, entryIds);
  const pending = new Map<number, { row: EntryMarkerRow; marker: boolean }>();
  for (const id of entryIds) {
    const row = rows.get(id);
    const marker = entryMarkerPrecheck(row);
    if (marker === null || !row) result.set(id, null);
    else pending.set(id, { row, marker });
  }

  const groupMarkers = new Map<number, boolean | null>();
  for (const { row } of pending.values()) {
    const groupId = Number(row.queue_group_id);
    if (!groupMarkers.has(groupId)) groupMarkers.set(groupId, await groupMarkerOrNull(db, groupId));
  }
  const grouped = new Map<number, { row: EntryMarkerRow; marker: boolean }>();
  for (const [id, item] of pending) {
    if (groupMarkers.get(Number(item.row.queue_group_id)) !== item.marker) result.set(id, null);
    else grouped.set(id, item);
  }

  const roomIds = [
    ...new Set(
      [...grouped.values()]
        .map(({ row }) => row.assigned_room_id)
        .filter((roomId): roomId is number => roomId != null)
        .map(Number),
    ),
  ];
  const roomMarkers = await queueRoomFixtureMarkers(db, roomIds);
  for (const [id, { row, marker }] of grouped) {
    const roomOk =
      row.assigned_room_id == null || roomMarkers.get(Number(row.assigned_room_id)) === marker;
    result.set(id, roomOk ? marker : null);
  }
  return result;
}

function roomMarkerFromScope(row: FixtureRoomScope): boolean | null {
  if (!row.exists) return null;
  // An unassigned room is part of the real operator surface, preserving the
  // existing pause/resume behavior for rooms with no queue yet.
  if (!row.has_graph) return false;
  if ((row.has_synthetic && row.has_real) || (!row.has_synthetic && !row.has_real)) {
    return null;
  }
  return row.has_synthetic;
}

/**
 * Set-based `queueFixtureMarker(db, "room", id)`: one query for many rooms,
 * identical fail-closed semantics (missing, mixed or marker-less graphs map
 * to null). Every requested id is present in the result.
 */
export async function queueRoomFixtureMarkers(
  db: Queryable,
  roomIds: readonly number[],
): Promise<Map<number, boolean | null>> {
  const scopes = await inspectFixtureRoomScopes(db, roomIds);
  return new Map(
    roomIds.map((id) => [id, roomMarkerFromScope(scopes.get(id) ?? MISSING_ROOM_SCOPE)]),
  );
}

const MISSING_ROOM_SCOPE: FixtureRoomScope = {
  exists: false,
  has_graph: false,
  has_synthetic: false,
  has_real: false,
};

/**
 * Publish one queue event on the marker-scoped operator topic. Marker lookup
 * is deliberately best-effort like `broadcast`: a lookup failure suppresses
 * the event rather than risking a fixture payload on the real stream.
 */
export async function broadcastQueueEvent<T>(
  db: Queryable,
  resource: QueueBroadcastResource,
  resourceId: number,
  type: string,
  data: T,
): Promise<SseEnvelope<T> | null> {
  let marker: boolean | null;
  try {
    marker = await queueFixtureMarker(db, resource, resourceId);
  } catch (err) {
    console.error(`[queue] unable to scope ${resource} broadcast`, err);
    return null;
  }
  return broadcastQueueEventWithMarker(marker, type, data);
}

/** Publish when the caller already resolved the marker in its transaction. */
export async function broadcastQueueEventWithMarker<T>(
  marker: boolean | null,
  type: string,
  data: T,
): Promise<SseEnvelope<T> | null> {
  if (marker === null) return null;
  return broadcast(queueTopicForFixture(marker), type, data);
}
