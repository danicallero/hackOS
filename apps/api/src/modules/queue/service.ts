import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type pg from "pg";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { notify } from "../notifications/service.js";
import { isRepoBlockedByBusyMember } from "./guard.js";
import { writeQueueHistory } from "./history.js";
import {
  notifyChallengeQueueChanged,
  notifyRoomQueueChanged,
  notifyTeamCalled,
  repoMemberIds,
} from "./notify.js";
import {
  compactChallengePositions,
  nextBottomPosition,
  nextTopPosition,
  type RequeuePosition,
  resolveRequeuePosition,
} from "./ordering.js";
import type { QueueEntryRow } from "./types.js";

/** Postgres unique_violation. Thrown by the `one_active_per_room` partial index (plan/07 invariant 2). */
const PG_UNIQUE_VIOLATION = "23505";

async function lockEntry(client: pg.PoolClient, entryId: number): Promise<QueueEntryRow> {
  const { rows } = await client.query(`SELECT * FROM queue_entries WHERE id = $1 FOR UPDATE`, [
    entryId,
  ]);
  if (rows.length === 0) throw new NotFoundError("Queue entry not found", { entryId });
  return rows[0];
}

async function broadcastEntry(entry: QueueEntryRow): Promise<QueueEntryRow> {
  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, entry);
  await notifyChallengeQueueChanged(pool, entry.challenge_id);
  return entry;
}

function assertFrom(entry: QueueEntryRow, allowed: string[], action: string): void {
  if (!allowed.includes(entry.status)) {
    throw new ConflictError(`Cannot ${action} from status "${entry.status}"`, {
      status: entry.status,
      allowed,
    });
  }
}

// ── H29/H30: call_next ──────────────────────────────────────────────────────

/**
 * Calls the next eligible `waiting` entry from any challenge assigned to
 * `roomId` into `called`. Skips (without losing queue position) any repo
 * blocked by H30. Returns null when the room is at capacity (unless
 * `force`) or no eligible candidate exists.
 */
export async function callNextForRoom(
  actorId: number | null,
  roomId: number,
  opts: { force?: boolean } = {},
): Promise<QueueEntryRow | null> {
  return withTransaction(async (client) => {
    const stateRes = await client.query(
      `SELECT * FROM room_queue_state WHERE room_id = $1 FOR UPDATE`,
      [roomId],
    );
    if (stateRes.rowCount === 0) throw new NotFoundError("Room not found", { roomId });
    const state = stateRes.rows[0];
    const roomRes = await client.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
    const room = roomRes.rows[0];
    if (!room) throw new NotFoundError("Room not found", { roomId });

    if (state.is_paused) throw new ConflictError("Room is paused", { roomId });

    if (!opts.force) {
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS n FROM queue_entries WHERE assigned_room_id = $1 AND status = 'called'`,
        [roomId],
      );
      if (countRows[0].n >= state.max_in_waiting_area) {
        throw new ConflictError("Waiting area is full", {
          roomId,
          maxInWaitingArea: state.max_in_waiting_area,
        });
      }
    }

    const { rows: challengeRows } = await client.query(
      `SELECT challenge_id FROM room_challenges WHERE room_id = $1`,
      [roomId],
    );
    const challengeIds = challengeRows.map((r: { challenge_id: number }) => r.challenge_id);
    if (challengeIds.length === 0) return null;

    // Ordering (H34 ladder): explicit priority first, then the no-show
    // ladder (more failed calls = lower priority, never eliminated), then
    // queue position. SKIP LOCKED: a candidate mid-transition in a parallel
    // call_next is simply not considered — the loser never blocks.
    const { rows: candidates } = await client.query(
      `SELECT * FROM queue_entries
        WHERE challenge_id = ANY($1) AND status = 'waiting'
        ORDER BY priority DESC, call_count ASC, position ASC NULLS LAST, id ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED`,
      [challengeIds],
    );

    for (const candidate of candidates as QueueEntryRow[]) {
      if (await isRepoBlockedByBusyMember(client, candidate.repo_id)) continue; // H30: skip, keep position

      const { rows: updatedRows } = await client.query(
        `UPDATE queue_entries
           SET status = 'called', assigned_room_id = $1, called_at = now(), precalled_at = NULL
         WHERE id = $2
         RETURNING *`,
        [roomId, candidate.id],
      );
      const entry: QueueEntryRow = updatedRows[0];
      await writeQueueHistory(client, {
        entryId: entry.id,
        actorId,
        previousStatus: "waiting",
        newStatus: "called",
        action: "call_next",
        metadata: { roomId, forced: Boolean(opts.force) },
      });
      await notifyTeamCalled(client, {
        entryId: entry.id,
        challengeId: entry.challenge_id,
        repoId: entry.repo_id,
        roomId,
        roomName: room.name,
        roomLocation: room.location,
      });
      return entry;
    }
    return null; // nobody eligible right now — candidates keep their position
  }).then(async (entry) => {
    if (entry) await broadcastEntry(entry);
    return entry;
  });
}

// ── H31: notify_enter (no status transition) ────────────────────────────────

export async function notifyEnter(entryId: number, actorId: number): Promise<QueueEntryRow> {
  const { entry, memberIds } = await withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, ["called"], "notify_enter");
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: entry.status,
      action: "notify_enter",
    });

    const memberIds = await repoMemberIds(client, entry.repo_id);
    const { rows: ctxRows } = await client.query(
      `SELECT c.title AS challenge_name, r.name AS room_name, r.location AS room_location
         FROM challenges c, rooms r
        WHERE c.id = $1 AND r.id = $2`,
      [entry.challenge_id, entry.assigned_room_id],
    );
    const challengeName: string = ctxRows[0]?.challenge_name ?? "";
    const roomName: string = ctxRows[0]?.room_name ?? "";
    const roomLocation: string | null = ctxRows[0]?.room_location ?? null;

    const { rows: userRows } = await client.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
      memberIds,
    ]);
    const nameById = new Map<number, string | null>(
      userRows.map((u: { id: number; name: string | null }) => [u.id, u.name]),
    );

    // H31: "que entre" — routed through notify() (H51/H53) so it lands in the
    // inbox and every configured channel, same as the initial call (H29/H38).
    for (const userId of memberIds) {
      await notify(client, {
        userId,
        category: "queue",
        payload: {
          entryId,
          type: "notify_enter",
          roomId: entry.assigned_room_id,
          roomName,
          roomLocation,
          template: "queue.enter",
          vars: { name: nameById.get(userId) ?? "", challengeName, roomName },
        },
      });
    }
    return { entry, memberIds };
  });

  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_NOTIFY_ENTER, entry);
  for (const userId of memberIds) {
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_NOTIFICATION, {
      entryId: entry.id,
      type: "notify_enter",
    });
  }
  return entry;
}

// ── H32: bring_in / start / complete ────────────────────────────────────────

export async function bringIn(entryId: number, actorId: number): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, ["called"], "bring_in");
    if (!entry.assigned_room_id) throw new ConflictError("Entry has no assigned room", { entryId });

    let updated: QueueEntryRow;
    try {
      const res = await client.query(
        `UPDATE queue_entries SET status = 'in_room' WHERE id = $1 RETURNING *`,
        [entryId],
      );
      updated = res.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError("Room already has an active team", {
          roomId: entry.assigned_room_id,
        });
      }
      throw err;
    }
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: "called",
      newStatus: "in_room",
      action: "bring_in",
    });
    return updated;
  }).then(broadcastEntry);
}

export async function startPresentation(entryId: number, actorId: number): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, ["in_room"], "start");
    const res = await client.query(
      `UPDATE queue_entries SET status = 'presenting', presentation_started_at = now() WHERE id = $1 RETURNING *`,
      [entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: "in_room",
      newStatus: "presenting",
      action: "start",
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

export async function completePresentation(
  entryId: number,
  actorId: number,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, ["presenting"], "complete");
    const res = await client.query(
      `UPDATE queue_entries SET status = 'completed', completed_at = now() WHERE id = $1 RETURNING *`,
      [entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: "presenting",
      newStatus: "completed",
      action: "complete",
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

// ── H33: send_back_to_waiting / requeue / re_enter ──────────────────────────

/** in_room|presenting -> called, TOP of the challenge's shared queue. */
export async function sendBackToWaiting(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, ["in_room", "presenting"], "send_back_to_waiting");
    const position = await resolveRequeuePosition(client, entry.challenge_id, "top");
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'called', position = $1, called_at = now(), presentation_started_at = NULL
        WHERE id = $2
        RETURNING *`,
      [position, entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: "called",
      action: "send_back_to_waiting",
      reason,
      metadata: { position: "top" },
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

/** called -> waiting, position top|bottom (plan/07 §4). */
export async function requeue(
  entryId: number,
  actorId: number,
  position: RequeuePosition,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, ["called"], "requeue");
    const pos = await resolveRequeuePosition(client, entry.challenge_id, position);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL
        WHERE id = $2
        RETURNING *`,
      [pos, entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: "called",
      newStatus: "waiting",
      action: "requeue",
      reason,
      metadata: { position },
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

const RE_ENTER_FROM = ["completed", "cancelled", "disqualified"];

/** Manual + audited recovery of a "forgotten" team from a terminal state (H33). */
export async function reEnter(
  entryId: number,
  actorId: number,
  position: RequeuePosition,
  reason: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, RE_ENTER_FROM, "re_enter");
    const pos = await resolveRequeuePosition(client, entry.challenge_id, position);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              presentation_started_at = NULL, completed_at = NULL
        WHERE id = $2
        RETURNING *`,
      [pos, entryId],
    );
    const updated = res.rows[0];
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: "waiting",
      action: "re_enter",
      reason,
      metadata: { position },
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entryId,
      action: "re_enter",
      before: { status: entry.status },
      after: { status: "waiting", position },
      reason,
    });
    return updated;
  }).then(broadcastEntry);
}

// ── H34: no_show (human decision) / skip (no penalty) ───────────────────────

const NO_SHOW_FROM = ["called", "in_room"];

/** called|in_room -> waiting (bottom), call_count++ (ladder), never eliminates. */
export async function markNoShow(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, NO_SHOW_FROM, "no_show");
    const position = await nextBottomPosition(client, entry.challenge_id);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              presentation_started_at = NULL, call_count = call_count + 1
        WHERE id = $2
        RETURNING *`,
      [position, entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: "waiting",
      action: "no_show",
      reason,
      metadata: { position: "bottom", callCount: entry.call_count + 1 },
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

const SKIP_FROM = ["waiting", "called"];

/** Staff sends a team to the end of the queue at their own request — no ladder penalty. */
export async function skipToEnd(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, SKIP_FROM, "skip");
    const position = await nextBottomPosition(client, entry.challenge_id);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              presentation_started_at = NULL
        WHERE id = $2
        RETURNING *`,
      [position, entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: "waiting",
      action: "skip",
      reason,
      metadata: { position: "bottom" },
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

const MOVE_TOP_FROM = ["waiting", "called"];

/** Statuses in which a team is actively occupying a room's waiting area / floor. */
const BUSY_IN_ROOM_STATUSES = ["called", "in_room", "presenting"];

/**
 * H58: is this repo currently active (called/in_room/presenting) in some room?
 * Returns that room's name so callers can surface `Busy in <room>` instead of
 * silently yanking the team out of its current room.
 */
async function repoBusyRoomName(client: pg.PoolClient, repoId: number): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT r.name
       FROM queue_entries qe
       JOIN rooms r ON r.id = qe.assigned_room_id
      WHERE qe.repo_id = $1 AND qe.status = ANY($2)
      LIMIT 1`,
    [repoId, BUSY_IN_ROOM_STATUSES],
  );
  return rows[0]?.name ?? null;
}

/**
 * H37: send a team to the TOP of its challenge's shared queue from the judging
 * search. "Adding" a team only ever moves the existing entry (never creates a
 * second one).
 *
 * H58: a team that is active in a room's waiting area (called/in_room/
 * presenting) must NOT be extracted from it by the search "Top" action —
 * doing so bypasses the validation the "add to waiting room" path enforces.
 * Block with an explicit `Busy in <room>` error and leave the state untouched.
 */
export async function moveToTop(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    const busyRoom = await repoBusyRoomName(client, entry.repo_id);
    if (busyRoom) {
      throw new ConflictError(`Busy in ${busyRoom}`, {
        entryId,
        repoId: entry.repo_id,
        roomName: busyRoom,
      });
    }
    assertFrom(entry, MOVE_TOP_FROM, "move_to_top");
    const position = await nextTopPosition(client, entry.challenge_id);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              presentation_started_at = NULL
        WHERE id = $2
        RETURNING *`,
      [position, entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: "waiting",
      action: "move_to_top",
      reason,
      metadata: { position: "top" },
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

const DISQUALIFY_FROM = ["waiting", "called", "in_room", "presenting"];

/** Manual, audited, for repeated no-shows (H34). Terminal — no automatic path back in. */
export async function disqualify(
  entryId: number,
  actorId: number,
  reason: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, DISQUALIFY_FROM, "disqualify");
    const res = await client.query(
      `UPDATE queue_entries SET status = 'disqualified' WHERE id = $1 RETURNING *`,
      [entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: "disqualified",
      action: "disqualify",
      reason,
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entryId,
      action: "disqualify",
      before: { status: entry.status },
      after: { status: "disqualified" },
      reason,
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

/** Admin cleanup (repo withdrawn, duplicate, etc). Not one of the H29-H40 actions but low-risk to expose. */
export async function cancelEntry(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, ["waiting", "called"], "cancel");
    const res = await client.query(
      `UPDATE queue_entries SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: "cancelled",
      action: "cancel",
      reason,
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entryId,
      action: "cancel",
      before: { status: entry.status },
      after: { status: "cancelled" },
      reason,
    });
    return res.rows[0];
  }).then(broadcastEntry);
}

/**
 * H21: remove a repo from a challenge queue. Waiting/called teams are
 * cancelled; teams already in the room are disqualified so the live judging
 * surface stops showing them. Remaining active entries are compacted.
 */
export async function removeRepoFromChallenge(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    const removable = ["waiting", "called", "in_room", "presenting"];
    assertFrom(entry, removable, "remove from challenge");
    const nextStatus =
      entry.status === "waiting" || entry.status === "called" ? "cancelled" : "disqualified";
    const res = await client.query(
      `UPDATE queue_entries
          SET status = $1, assigned_room_id = NULL, position = NULL, called_at = NULL,
              precalled_at = NULL, presentation_started_at = NULL, completed_at = NULL
        WHERE id = $2
        RETURNING *`,
      [nextStatus, entryId],
    );
    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: nextStatus,
      action: "remove_from_challenge",
      reason,
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entryId,
      action: "remove_from_challenge",
      before: { status: entry.status, challengeId: entry.challenge_id, repoId: entry.repo_id },
      after: { status: nextStatus },
      reason,
    });
    await compactChallengePositions(client, entry.challenge_id);
    return res.rows[0];
  }).then(broadcastEntry);
}

// ── manual call (any team, any position, H37 search-and-bring-in) ──────────

export async function manualCall(
  entryId: number,
  actorId: number,
  targetStatus: "called" | "in_room",
  roomId: number,
  reason: string | undefined,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    if (entry.status === targetStatus) {
      throw new ConflictError(`Entry is already ${targetStatus}`, { entryId });
    }
    if (await isRepoBlockedByBusyMember(client, entry.repo_id)) {
      throw new ConflictError("Team has a member busy in another room (H30)", { entryId });
    }
    const roomRes = await client.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
    const room = roomRes.rows[0];
    if (!room) throw new NotFoundError("Room not found", { roomId });

    let updated: QueueEntryRow;
    try {
      const res = await client.query(
        `UPDATE queue_entries
            SET status = $1, assigned_room_id = $2,
                called_at = COALESCE(called_at, now())
          WHERE id = $3
          RETURNING *`,
        [targetStatus, roomId, entryId],
      );
      updated = res.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError("Room already has an active team", { roomId });
      }
      throw err;
    }

    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: targetStatus,
      action: "manual_call",
      reason,
      metadata: { roomId, manual: true },
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entryId,
      action: "manual_call",
      before: { status: entry.status },
      after: { status: targetStatus, roomId },
      reason,
    });

    if (targetStatus === "called") {
      await notifyTeamCalled(client, {
        entryId: updated.id,
        challengeId: updated.challenge_id,
        repoId: updated.repo_id,
        roomId,
        roomName: room.name,
        roomLocation: room.location,
      });
    }
    return updated;
  }).then(broadcastEntry);
}

// ── enqueue (admin) ──────────────────────────────────────────────────────────

export async function enqueueChallenge(
  challengeId: number,
  actorId: number,
  repoIds?: number[],
): Promise<{ inserted: number[]; alreadyQueued: number[] }> {
  const result = await withTransaction(async (client) => {
    let ids = repoIds;
    if (!ids || ids.length === 0) {
      const challengeRes = await client.query(`SELECT devpost_tags FROM challenges WHERE id = $1`, [
        challengeId,
      ]);
      if (challengeRes.rowCount === 0)
        throw new NotFoundError("Challenge not found", { challengeId });
      const tags: string[] = challengeRes.rows[0].devpost_tags ?? [];
      if (tags.length === 0) {
        return { inserted: [] as { entry: QueueEntryRow }[], alreadyQueued: [] as number[] };
      }
      const { rows } = await client.query(
        `SELECT DISTINCT repo_id FROM repo_devpost_prizes WHERE prize = ANY($1)`,
        [tags],
      );
      ids = rows.map((r: { repo_id: number }) => r.repo_id);
    }

    const inserted: { entry: QueueEntryRow }[] = [];
    const alreadyQueued: number[] = [];
    for (const repoId of ids) {
      const position = await nextBottomPosition(client, challengeId);
      const res = await client.query(
        `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
         VALUES ($1, $2, 'waiting', $3)
         ON CONFLICT (challenge_id, repo_id) DO NOTHING
         RETURNING *`,
        [challengeId, repoId, position],
      );
      if (res.rowCount) {
        const entry: QueueEntryRow = res.rows[0];
        await writeQueueHistory(client, {
          entryId: entry.id,
          actorId,
          previousStatus: "none",
          newStatus: "waiting",
          action: "enqueue",
        });
        inserted.push({ entry });
      } else {
        alreadyQueued.push(repoId);
      }
    }
    return { inserted, alreadyQueued };
  });

  for (const { entry } of result.inserted) {
    await broadcastEntry(entry);
  }
  return { inserted: result.inserted.map((i) => i.entry.id), alreadyQueued: result.alreadyQueued };
}

// ── H35: pause / resume a room ───────────────────────────────────────────────

/**
 * Pause (H35, plan/07 §4): `called` entries of the room are reinjected into
 * `waiting` at the TOP of their challenge's shared queue, preserving arrival
 * order — whoever has been called longest ends up topmost. in_room/presenting
 * finish normally (untouched); the pump skips paused rooms. No call_count
 * penalty (this is the org's fault, not the team's).
 */
export async function pauseRoom(roomId: number, actorId: number): Promise<void> {
  await withTransaction(async (client) => {
    const stateRes = await client.query(
      `SELECT * FROM room_queue_state WHERE room_id = $1 FOR UPDATE`,
      [roomId],
    );
    if (stateRes.rowCount === 0) throw new NotFoundError("Room not found", { roomId });
    if (stateRes.rows[0].is_paused) return; // idempotent no-op

    await client.query(`UPDATE room_queue_state SET is_paused = true WHERE room_id = $1`, [roomId]);

    const { rows: calledEntries } = await client.query(
      `SELECT * FROM queue_entries WHERE assigned_room_id = $1 AND status = 'called'
        ORDER BY called_at ASC
        FOR UPDATE`,
      [roomId],
    );

    // Group by challenge — "top" is relative to each challenge's own shared queue.
    const byChallenge = new Map<number, QueueEntryRow[]>();
    for (const e of calledEntries as QueueEntryRow[]) {
      const list = byChallenge.get(e.challenge_id) ?? [];
      list.push(e);
      byChallenge.set(e.challenge_id, list);
    }
    for (const [challengeId, entries] of byChallenge) {
      const { rows: minRow } = await client.query(
        `SELECT COALESCE(MIN(position), 0) AS min FROM queue_entries WHERE challenge_id = $1`,
        [challengeId],
      );
      // entries[] is sorted longest-called first; base + i keeps that order,
      // so the longest-called team gets the topmost (lowest) position.
      const base = Number(minRow[0].min) - entries.length;
      for (const [i, entry] of entries.entries()) {
        await client.query(
          `UPDATE queue_entries
              SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL
            WHERE id = $2`,
          [base + i, entry.id],
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

  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ROOM_CHANGED, { roomId, isPaused: true });
  await notifyRoomQueueChanged(pool, roomId);
}

export async function resumeRoom(roomId: number, _actorId: number): Promise<void> {
  await withTransaction(async (client) => {
    const stateRes = await client.query(
      `SELECT * FROM room_queue_state WHERE room_id = $1 FOR UPDATE`,
      [roomId],
    );
    if (stateRes.rowCount === 0) throw new NotFoundError("Room not found", { roomId });
    await client.query(
      `UPDATE room_queue_state SET is_paused = false, started_at = COALESCE(started_at, now()) WHERE room_id = $1`,
      [roomId],
    );
  });
  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ROOM_CHANGED, { roomId, isPaused: false });
  await notifyRoomQueueChanged(pool, roomId);
}
