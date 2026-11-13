import { EVENTS } from "@hackos/shared/events";

import { pool, withTransaction } from "../../db/pool.js";

import { afterCommit } from "../../lib/after-commit.js";

import { NotFoundError } from "../../lib/errors.js";

import { broadcastQueueEventWithMarker } from "./broadcast.js";

import { assertQueueRoomScope } from "./fixture-scope.js";

import { challengeQueueGroupId } from "./groups.js";

import { writeQueueHistory } from "./history.js";

import { notifyRoomQueueChanged } from "./notify.js";

import { placeEntriesOnTop } from "./ordering.js";

import type { QueueEntryRow } from "./types.js";

// ── H35: pause / resume a room ───────────────────────────────────────────────

/**
 * Pause (H35, plan/07 §4): `called` entries of the room are reinjected into
 * `waiting` at the TOP of their challenge's shared queue, preserving arrival
 * order — whoever has been called longest ends up topmost. in_room/presenting
 * finish normally (untouched); the pump skips paused rooms. No call_count
 * penalty (this is the org's fault, not the team's).
 */
export async function pauseRoom(roomId: number, actorId: number): Promise<void> {
  let scopedMarker: boolean | null = null;
  await withTransaction(async (client) => {
    const stateRes = await client.query(
      `SELECT * FROM room_queue_state WHERE room_id = $1 FOR UPDATE`,
      [roomId],
    );
    if (stateRes.rowCount === 0) throw new NotFoundError("Room not found", { roomId });
    const fixtureMarker = await assertQueueRoomScope(client, actorId, roomId);
    scopedMarker = fixtureMarker;
    if (stateRes.rows[0].is_paused) return; // idempotent no-op

    await client.query(`UPDATE room_queue_state SET is_paused = true WHERE room_id = $1`, [roomId]);

    const { rows: calledEntries } = await client.query(
      `SELECT qe.*
         FROM queue_entries qe
         JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
         JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
        WHERE qe.assigned_room_id = $1 AND qe.status = 'called'
        ORDER BY qe.called_at ASC
        FOR UPDATE`,
      [roomId, fixtureMarker],
    );

    // Group by queue_group — "top" is relative to the group's shared queue,
    // which is the ordering key space positions live in (ordering.ts). One
    // group per challenge today, so this partitions exactly as it used to.
    const byGroup = new Map<number, QueueEntryRow[]>();
    for (const e of calledEntries as QueueEntryRow[]) {
      const groupId = await challengeQueueGroupId(client, e.challenge_id);
      // A managed challenge should always have a group row, but a
      // negative synthetic key keeps such a row in its own partition rather
      // than silently merging every ungrouped entry together.
      const key = groupId ?? -e.challenge_id;
      const list = byGroup.get(key) ?? [];
      list.push(e);
      byGroup.set(key, list);
    }
    for (const entries of byGroup.values()) {
      const first = entries[0];
      if (!first) continue;
      // entries[] is sorted longest-called first, so putting them on top in
      // that order gives the longest-called team position 1.
      await placeEntriesOnTop(
        client,
        first.challenge_id,
        entries.map((entry) => entry.id),
      );
      for (const entry of entries) {
        await client.query(
          `UPDATE queue_entries
              SET status = 'waiting', assigned_room_id = NULL, called_at = NULL,
                  precalled_at = NULL
            WHERE id = $1`,
          [entry.id],
        );
        await writeQueueHistory(client, {
          entryId: entry.id,
          actorId,
          previousStatus: "called",
          newStatus: "waiting",
          action: "pause_room_requeue",
          metadata: { roomId, position: "top" },
        });
      }
    }
    // The room-level pause itself isn't a queue_entries transition; the one
    // pause action maps to one QUEUE_ROOM_CHANGED broadcast (below) and one
    // history row per reinjected entry (needed by the per-entry history
    // endpoint, H34).
  });

  await afterCommit(`room ${roomId} pause broadcast`, () =>
    Promise.all([
      broadcastQueueEventWithMarker(scopedMarker, EVENTS.QUEUE_ROOM_CHANGED, {
        roomId,
        isPaused: true,
      }),
      notifyRoomQueueChanged(pool, roomId, scopedMarker),
    ]),
  );
}

export async function resumeRoom(roomId: number, actorId: number): Promise<void> {
  let scopedMarker: boolean | null = null;
  await withTransaction(async (client) => {
    const stateRes = await client.query(
      `SELECT * FROM room_queue_state WHERE room_id = $1 FOR UPDATE`,
      [roomId],
    );
    if (stateRes.rowCount === 0) throw new NotFoundError("Room not found", { roomId });
    scopedMarker = await assertQueueRoomScope(client, actorId, roomId);
    await client.query(
      `UPDATE room_queue_state SET is_paused = false, started_at = COALESCE(started_at, now()) WHERE room_id = $1`,
      [roomId],
    );
  });
  await afterCommit(`room ${roomId} resume broadcast`, () =>
    Promise.all([
      broadcastQueueEventWithMarker(scopedMarker, EVENTS.QUEUE_ROOM_CHANGED, {
        roomId,
        isPaused: false,
      }),
      notifyRoomQueueChanged(pool, roomId, scopedMarker),
    ]),
  );
}
