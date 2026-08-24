import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type pg from "pg";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { notify, QUEUE_STAFF_CATEGORY } from "../notifications/service.js";
import { anyEvaluationStarted, lockQueueGroupForEntry } from "./evaluation-lock.js";
import { challengeQueueGroupId, roomChallengeIds } from "./groups.js";
import { isRepoBlockedByBusyMember } from "./guard.js";
import { writeQueueHistory } from "./history.js";
import {
  notifyChallengeQueueChanged,
  notifyRoomQueueChanged,
  notifyTeamCalled,
  repoMemberIds,
} from "./notify.js";
import {
  compactQueueGroupPositions,
  placeEntriesOnTop,
  placeEntry,
  type RequeuePosition,
} from "./ordering.js";
import type { QueueEntryRow } from "./types.js";

/**
 * Postgres unique_violation. Thrown by the `one_active_per_room` partial
 * index (plan/07 invariant 2) and the `one_active_entry_per_repo` partial
 * index (H30 backstop, plan/07 §2/§4).
 */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Lock an entry for a state transition, together with every other active
 * entry of its queue_group, **in a single id-ordered statement**.
 *
 * The group has to come along because a transition renumbers the group's
 * positions (see `ordering.ts`). Locking the entry first and the group second
 * deadlocks: two operators moving two teams in one queue each hold the other's
 * row and then wait for the rest. One statement, ordered by `id`, gives every
 * transaction the same acquisition order, so they queue up instead.
 *
 * The entry itself is included by `qe.id = $1` even when its status is not
 * active (`in_room`, `presenting`, a completed row being re-entered).
 */
async function lockEntry(client: pg.PoolClient, entryId: number): Promise<QueueEntryRow> {
  const { rows } = await client.query(
    `SELECT qe.*
       FROM queue_entries qe
      WHERE qe.id = $1
         OR (qe.status IN ('waiting', 'called')
             AND qe.challenge_id IN (
               SELECT sibling.challenge_id
                 FROM queue_group_challenges self
                 JOIN queue_group_challenges sibling
                   ON sibling.queue_group_id = self.queue_group_id
                WHERE self.challenge_id = (SELECT challenge_id FROM queue_entries WHERE id = $1)
             ))
      ORDER BY qe.id
      FOR UPDATE`,
    [entryId],
  );
  const entry = rows.find((row: QueueEntryRow) => Number(row.id) === entryId);
  if (!entry) throw new NotFoundError("Queue entry not found", { entryId });
  return entry;
}

async function broadcastEntry(entry: QueueEntryRow): Promise<QueueEntryRow> {
  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, entry);
  await notifyChallengeQueueChanged(pool, entry.challenge_id);
  return entry;
}

/**
 * Participant-facing read-model signal only, no `SSE_TOPICS.QUEUE` broadcast.
 * Used where `notifyTeamCalled` already broadcast `QUEUE_TEAM_CALLED` to the
 * queue topic for this same action — plan/07 invariant 5 allows exactly one
 * queue-topic broadcast per action, so this avoids doubling it up.
 */
async function signalChallengeQueueChanged(entry: QueueEntryRow): Promise<QueueEntryRow> {
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

    // H46: the room's callable set is every challenge in the queue_group it
    // serves — one challenge today, 1..N once groups are merged. call_next
    // already selected across a list, so widening the list is all this needs.
    const challengeIds = await roomChallengeIds(client, roomId);
    if (challengeIds.length === 0) return null;

    // Ordering (H34 ladder): explicit priority first, then the no-show
    // ladder (more failed calls = lower priority, never eliminated), then
    // queue position. SKIP LOCKED: a candidate mid-transition in a parallel
    // call_next is simply not considered — the loser never blocks.
    //
    // H46 "call once" (§8 Q1): a repo already called, in a room, or judged for
    // ANOTHER of this group's challenges is done with the group — one panel,
    // one session, one call. Its remaining sibling entries drop out of the
    // candidate set rather than being called a second time. The NOT EXISTS can
    // never match for a 1:1 group (a repo has at most one entry per challenge,
    // so the only sibling is the row itself), so today's candidate list and
    // ordering are unchanged.
    const { rows: candidates } = await client.query(
      `SELECT * FROM queue_entries qe
        WHERE qe.challenge_id = ANY($1) AND qe.status = 'waiting'
          AND NOT EXISTS (
            SELECT 1 FROM queue_entries sib
             WHERE sib.repo_id = qe.repo_id
               AND sib.challenge_id = ANY($1)
               AND sib.id <> qe.id
               AND sib.status IN ('called', 'in_room', 'presenting', 'completed')
          )
        ORDER BY qe.priority DESC, qe.call_count ASC, qe.position ASC NULLS LAST, qe.id ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED`,
      [challengeIds],
    );

    // H46 "call once": within one queue_group a repo is a single line item,
    // however many of the group's challenges it applied to. `candidates` is
    // already in queue order, so the first row per repo is the one the merged
    // view shows and the only one callable; its siblings are passed over.
    // No-op for every group today (1:1 groups can only yield one row per repo).
    const seenRepoIds = new Set<number>();

    for (const candidate of candidates as QueueEntryRow[]) {
      if (seenRepoIds.has(candidate.repo_id)) continue;
      seenRepoIds.add(candidate.repo_id);
      if (
        await isRepoBlockedByBusyMember(client, candidate.repo_id, {
          roomId,
          excludeEntryId: candidate.id,
        })
      )
        continue; // H30: skip, keep position

      let entry: QueueEntryRow;
      // H30 backstop (one_active_entry_per_repo, plan/07 §2): the guard above
      // should already have caught this, but a repo with no resolvable
      // members at check time could slip through it — the unique index is
      // the structural guarantee. A savepoint is required here because a
      // failed statement aborts the whole outer transaction in Postgres;
      // without it `continue` would just defer the crash to the next
      // statement (H30, GH-525).
      await client.query(`SAVEPOINT call_next_candidate`);
      try {
        const res = await client.query(
          `UPDATE queue_entries
             SET status = 'called', assigned_room_id = $1, called_at = now(), precalled_at = NULL
           WHERE id = $2
           RETURNING *`,
          [roomId, candidate.id],
        );
        entry = res.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
          await client.query(`ROLLBACK TO SAVEPOINT call_next_candidate`);
          continue;
        }
        throw err;
      }
      await client.query(`RELEASE SAVEPOINT call_next_candidate`);
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
    if (entry) await signalChallengeQueueChanged(entry);
    return entry;
  });
}

// ── H31: notify_enter (no status transition) ────────────────────────────────

export async function notifyEnter(entryId: number, actorId: number): Promise<QueueEntryRow> {
  const { entry, memberIds, eventPayload } = await withTransaction(async (client) => {
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
    const { rows: repoRows } = await client.query(`SELECT name FROM repos WHERE id = $1`, [
      entry.repo_id,
    ]);
    const teamName: string = repoRows[0]?.name ?? `#${entry.repo_id}`;

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
    const { rows: staffRows } = await client.query(
      `SELECT DISTINCT user_id
         FROM notification_preferences
        WHERE category = $1 AND channel = 'push' AND enabled = true`,
      [QUEUE_STAFF_CATEGORY],
    );
    for (const row of staffRows as { user_id: number }[]) {
      await notify(client, {
        userId: row.user_id,
        category: QUEUE_STAFF_CATEGORY,
        channels: ["push"],
        payload: {
          entryId,
          roomId: entry.assigned_room_id,
          template: "queue.staff.enter",
          vars: { teamName, challengeName, roomName },
        },
      });
    }
    return {
      entry,
      memberIds,
      eventPayload: {
        ...entry,
        team_name: teamName,
        challenge_name: challengeName,
        room_name: roomName,
        room_location: roomLocation,
      },
    };
  });

  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_NOTIFY_ENTER, eventPayload);
  for (const userId of memberIds) {
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_NOTIFICATION, {
      entryId: entry.id,
      type: "notify_enter",
    });
  }
  return entry;
}

/** H29: remind a team already in the waiting room to come to this room and wait. */
export async function remindWaitingRoom(entryId: number, actorId: number): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    assertFrom(entry, ["called"], "remind_waiting_room");
    if (entry.assigned_room_id == null) {
      throw new ConflictError("Called team has no waiting room", { entryId });
    }

    const { rows: roomRows } = await client.query(
      `SELECT name, location FROM rooms WHERE id = $1`,
      [entry.assigned_room_id],
    );
    const room = roomRows[0] as { name: string; location: string | null } | undefined;
    if (!room)
      throw new NotFoundError("Waiting room not found", { roomId: entry.assigned_room_id });

    await writeQueueHistory(client, {
      entryId,
      actorId,
      previousStatus: entry.status,
      newStatus: entry.status,
      action: "remind_waiting_room",
    });
    await notifyTeamCalled(client, {
      entryId,
      challengeId: entry.challenge_id,
      repoId: entry.repo_id,
      roomId: entry.assigned_room_id,
      roomName: room.name,
      roomLocation: room.location,
    });
    return entry;
  });
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
    // Manual completion is also an evaluation boundary. Match structural
    // queue edits' group-then-entry lock order before setting `completed`.
    await lockQueueGroupForEntry(client, entryId);
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
    const position = await placeEntry(client, entry.challenge_id, entryId, "top");
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
    await assertEntryCanMove(client, entry);
    assertFrom(entry, ["called"], "requeue");
    const pos = await placeEntry(client, entry.challenge_id, entryId, position);
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
    const pos = await placeEntry(client, entry.challenge_id, entryId, position);
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
    const position = await placeEntry(client, entry.challenge_id, entryId, "bottom");
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

const MOVE_TO_POSITION_FROM = ["waiting", "called"];

/**
 * Put a waiting/called team at an explicit place in its queue_group's queue.
 * The rank is 1-based and clamped into range, and the whole group is
 * renumbered around it, so the number the operator typed is the number every
 * surface then shows (see `ordering.ts`).
 */
export async function moveToPosition(
  entryId: number,
  actorId: number,
  rank: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryCanMove(client, entry);
    assertFrom(entry, MOVE_TO_POSITION_FROM, "move_to_position");
    const position = await placeEntry(client, entry.challenge_id, entryId, { rank });
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
      action: "move_to_position",
      reason,
      metadata: { position, requestedRank: rank },
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
    await assertEntryCanMove(client, entry);
    assertFrom(entry, SKIP_FROM, "skip");
    const position = await placeEntry(client, entry.challenge_id, entryId, "bottom");
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

/** Statuses in which a team is actively being evaluated, not merely waiting at the door. */
const EVALUATING_STATUSES = ["in_room", "presenting"];

/**
 * H58: is this repo currently being evaluated in some room?
 * Returns that room's name so callers can surface `Busy in <room>` instead of
 * silently yanking the team out of its current room.
 */
async function repoBusyRoomName(
  client: pg.PoolClient,
  repoId: number,
  excludeEntryId?: number | null,
): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT r.name
       FROM queue_entries qe
       JOIN rooms r ON r.id = qe.assigned_room_id
      WHERE qe.repo_id = $1 AND qe.status = ANY($2)
        AND ($3::int IS NULL OR qe.id <> $3::int)
      LIMIT 1`,
    [repoId, EVALUATING_STATUSES, excludeEntryId ?? null],
  );
  return rows[0]?.name ?? null;
}

/**
 * Reordering is safe only while this entry is not being evaluated and none
 * of the team's members is active in another room. A called entry may still
 * be moved out of its own waiting room; the current entry is therefore
 * excluded from the shared-member guard.
 */
async function assertEntryCanMove(client: pg.PoolClient, entry: QueueEntryRow): Promise<void> {
  const blocked = await isRepoBlockedByBusyMember(client, entry.repo_id, {
    roomId: entry.assigned_room_id,
    excludeEntryId: entry.id,
    statuses: EVALUATING_STATUSES,
  });
  if (!blocked) return;
  const busyRoom = await repoBusyRoomName(client, entry.repo_id, entry.id);
  throw new ConflictError(
    busyRoom ? `Busy in ${busyRoom}` : "Team has a member busy in another room (H30)",
    { entryId: entry.id, repoId: entry.repo_id, ...(busyRoom ? { roomName: busyRoom } : {}) },
  );
}

/**
 * H37: send a team to the TOP of its challenge's shared queue from the judging
 * search. "Adding" a team only ever moves the existing entry (never creates a
 * second one).
 *
 * H58: a team being evaluated, or a team with a member active in another room,
 * must NOT be extracted from its current judging flow by the search "Top"
 * action. A called team may still be moved out of its own waiting room; that
 * is the operator's explicit top-priority action.
 */
export async function moveToTop(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryCanMove(client, entry);
    assertFrom(entry, MOVE_TOP_FROM, "move_to_top");
    const position = await placeEntry(client, entry.challenge_id, entryId, "top");
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
    await compactQueueGroupPositions(client, entry.challenge_id);
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
    if (targetStatus === "called" && entry.status !== "waiting") {
      throw new ConflictError("Only a waiting team can be sent to a waiting room", { entryId });
    }
    if (
      await isRepoBlockedByBusyMember(client, entry.repo_id, {
        roomId,
        excludeEntryId: entry.id,
      })
    ) {
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
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === PG_UNIQUE_VIOLATION && pgErr.constraint === "one_active_entry_per_repo") {
        throw new ConflictError("Team has a member busy in another room (H30)", { entryId });
      }
      if (pgErr.code === PG_UNIQUE_VIOLATION) {
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
  }).then(async (updated) => {
    // targetStatus === "called" already broadcast QUEUE_TEAM_CALLED to the
    // queue topic above (notifyTeamCalled) — plan/07 invariant 5, one
    // broadcast per action.
    if (updated.status === "called") return signalChallengeQueueChanged(updated);
    return broadcastEntry(updated);
  });
}

// ── enqueue (admin) ──────────────────────────────────────────────────────────

type QueueGenerationOutcome = {
  entry: QueueEntryRow;
  inserted: boolean;
  revived: boolean;
};

/**
 * Add one repo to one challenge without changing the order of any existing
 * team. A queue reset is the only operation allowed to revive a cancelled
 * entry; an ordinary cancellation or disqualification remains respected on a
 * later regeneration.
 */
async function enqueueQueueRepo(
  client: pg.PoolClient,
  actorId: number,
  repoId: number,
  challengeId: number,
): Promise<QueueGenerationOutcome | null> {
  const existing = await client.query(
    `SELECT * FROM queue_entries WHERE repo_id = $1 AND challenge_id = $2 FOR UPDATE`,
    [repoId, challengeId],
  );
  if (existing.rows[0]) {
    const entry = existing.rows[0] as QueueEntryRow;
    if (entry.status !== "cancelled") return null;
    const lastAction = await client.query(
      `SELECT action FROM queue_history WHERE queue_entry_id = $1 ORDER BY id DESC LIMIT 1`,
      [entry.id],
    );
    if (lastAction.rows[0]?.action !== "queue_clear") return null;

    const revived = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', assigned_room_id = NULL,
              called_at = NULL, presentation_started_at = NULL, completed_at = NULL,
              precalled_at = NULL
        WHERE id = $1
        RETURNING *`,
      [entry.id],
    );
    const position = await placeEntry(client, challengeId, entry.id, "bottom");
    const positioned = await client.query(`SELECT * FROM queue_entries WHERE id = $1`, [entry.id]);
    await writeQueueHistory(client, {
      entryId: entry.id,
      actorId,
      previousStatus: entry.status,
      newStatus: "waiting",
      action: "queue_regenerate",
      metadata: { position: "bottom", regeneratedPosition: position },
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entry.id,
      action: "queue_regenerate",
      before: { status: entry.status },
      after: { status: "waiting", position },
      source: "admin",
    });
    return { entry: positioned.rows[0] ?? revived.rows[0], inserted: false, revived: true };
  }

  const inserted = await client.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status)
     VALUES ($1, $2, 'waiting')
     RETURNING *`,
    [challengeId, repoId],
  );
  const entry = inserted.rows[0] as QueueEntryRow;
  const position = await placeEntry(client, challengeId, entry.id, "bottom");
  const positioned = await client.query(`SELECT * FROM queue_entries WHERE id = $1`, [entry.id]);
  await writeQueueHistory(client, {
    entryId: entry.id,
    actorId,
    previousStatus: "none",
    newStatus: "waiting",
    action: "enqueue",
    metadata: { position: "bottom", generatedPosition: position },
  });
  await audit(client, {
    actorId,
    entityType: "queue_entry",
    entityId: entry.id,
    action: "enqueue",
    after: { challengeId, repoId, status: "waiting", position },
    source: "admin",
  });
  return { entry: positioned.rows[0] ?? entry, inserted: true, revived: false };
}

async function challengePrizeRepoIds(
  client: pg.PoolClient,
  challengeId: number,
): Promise<number[]> {
  const challenge = await client.query(`SELECT devpost_tags FROM challenges WHERE id = $1`, [
    challengeId,
  ]);
  if (challenge.rowCount === 0) throw new NotFoundError("Challenge not found", { challengeId });
  const tags: string[] = challenge.rows[0].devpost_tags ?? [];
  if (tags.length === 0) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT repo_id FROM repo_devpost_prizes WHERE prize = ANY($1)`,
    [tags],
  );
  return rows.map((row: { repo_id: number }) => Number(row.repo_id));
}

export async function enqueueChallenge(
  challengeId: number,
  actorId: number,
  repoIds?: number[],
): Promise<{ inserted: number[]; alreadyQueued: number[] }> {
  const result = await withTransaction(async (client) => {
    let ids = repoIds;
    if (!ids || ids.length === 0) {
      ids = await challengePrizeRepoIds(client, challengeId);
    }

    const inserted: { entry: QueueEntryRow }[] = [];
    const alreadyQueued: number[] = [];
    for (const repoId of ids) {
      const outcome = await enqueueQueueRepo(client, actorId, repoId, challengeId);
      if (outcome) inserted.push({ entry: outcome.entry });
      else alreadyQueued.push(repoId);
    }
    return { inserted, alreadyQueued };
  });

  for (const { entry } of result.inserted) {
    await broadcastEntry(entry);
  }
  return { inserted: result.inserted.map((i) => i.entry.id), alreadyQueued: result.alreadyQueued };
}

/**
 * Generate one queue from its member challenges. Repeated calls only append
 * newly eligible projects (and entries previously cleared by this queue's own
 * reset); existing waiting, called, and evaluated teams keep their positions.
 */
export async function enqueueQueueGroup(
  queueGroupId: number,
  actorId: number,
): Promise<{
  challenges: Array<{
    challengeId: number;
    inserted: number;
    revived: number;
    alreadyQueued: number;
  }>;
  inserted: number;
  revived: number;
  alreadyQueued: number;
}> {
  const result = await withTransaction(async (client) => {
    const group = await client.query(`SELECT id FROM queue_groups WHERE id = $1 FOR UPDATE`, [
      queueGroupId,
    ]);
    if (group.rowCount === 0) {
      throw new NotFoundError("Queue group not found", { queueGroupId });
    }
    const { rows: challenges } = await client.query(
      `SELECT c.id FROM queue_group_challenges qgc
        JOIN challenges c ON c.id = qgc.challenge_id
       WHERE qgc.queue_group_id = $1 ORDER BY c.id`,
      [queueGroupId],
    );
    const changed: QueueEntryRow[] = [];
    const perChallenge: Array<{
      challengeId: number;
      inserted: number;
      revived: number;
      alreadyQueued: number;
    }> = [];
    for (const challenge of challenges as Array<{ id: number }>) {
      const challengeId = Number(challenge.id);
      const repoIds = await challengePrizeRepoIds(client, challengeId);
      let inserted = 0;
      let revived = 0;
      let alreadyQueued = 0;
      for (const repoId of repoIds) {
        const outcome = await enqueueQueueRepo(client, actorId, repoId, challengeId);
        if (!outcome) {
          alreadyQueued += 1;
          continue;
        }
        changed.push(outcome.entry);
        if (outcome.revived) revived += 1;
        else inserted += 1;
      }
      perChallenge.push({ challengeId, inserted, revived, alreadyQueued });
    }
    return { changed, perChallenge };
  });

  for (const entry of result.changed) await broadcastEntry(entry);
  return {
    challenges: result.perChallenge,
    inserted: result.perChallenge.reduce((sum, row) => sum + row.inserted, 0),
    revived: result.perChallenge.reduce((sum, row) => sum + row.revived, 0),
    alreadyQueued: result.perChallenge.reduce((sum, row) => sum + row.alreadyQueued, 0),
  };
}

/** Clear a queue before its first evaluation, preserving its group/configuration. */
export async function clearQueueGroup(
  queueGroupId: number,
  actorId: number,
): Promise<{ cleared: number }> {
  const result = await withTransaction(async (client) => {
    const group = await client.query(`SELECT id FROM queue_groups WHERE id = $1 FOR UPDATE`, [
      queueGroupId,
    ]);
    if (group.rowCount === 0) {
      throw new NotFoundError("Queue group not found", { queueGroupId });
    }
    const { rows: challenges } = await client.query(
      `SELECT challenge_id FROM queue_group_challenges WHERE queue_group_id = $1 ORDER BY challenge_id`,
      [queueGroupId],
    );
    const challengeIds = challenges.map((row: { challenge_id: number }) =>
      Number(row.challenge_id),
    );
    if (await anyEvaluationStarted(client, challengeIds)) {
      throw new ConflictError("Cannot clear a queue once a team has been evaluated", {
        queueGroupId,
      });
    }

    const entries = await client.query(
      `SELECT * FROM queue_entries
        WHERE challenge_id = ANY($1::int[]) AND status IN ('waiting', 'called', 'in_room', 'presenting')
        ORDER BY id FOR UPDATE`,
      [challengeIds],
    );
    const activeInRoom = (entries.rows as QueueEntryRow[]).find((entry) =>
      ["in_room", "presenting"].includes(entry.status),
    );
    if (activeInRoom) {
      throw new ConflictError("Cannot clear a queue while a team is in a room", {
        queueGroupId,
        entryId: activeInRoom.id,
      });
    }

    const cleared: QueueEntryRow[] = [];
    for (const entry of entries.rows as QueueEntryRow[]) {
      const updated = await client.query(
        `UPDATE queue_entries
            SET status = 'cancelled', assigned_room_id = NULL,
                called_at = NULL, precalled_at = NULL
          WHERE id = $1 RETURNING *`,
        [entry.id],
      );
      await writeQueueHistory(client, {
        entryId: entry.id,
        actorId,
        previousStatus: entry.status,
        newStatus: "cancelled",
        action: "queue_clear",
      });
      cleared.push(updated.rows[0]);
    }
    if (challengeIds[0] !== undefined) await compactQueueGroupPositions(client, challengeIds[0]);
    await audit(client, {
      actorId,
      entityType: "queue_group",
      entityId: queueGroupId,
      action: "queue_group.clear",
      after: { cleared: cleared.length },
      source: "admin",
    });
    return cleared;
  });

  for (const entry of result) await broadcastEntry(entry);
  return { cleared: result.length };
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

    // Group by queue_group — "top" is relative to the group's shared queue,
    // which is the ordering key space positions live in (ordering.ts). One
    // group per challenge today, so this partitions exactly as it used to.
    const byGroup = new Map<number, QueueEntryRow[]>();
    for (const e of calledEntries as QueueEntryRow[]) {
      const groupId = await challengeQueueGroupId(client, e.challenge_id);
      // A challenge with no group row cannot exist (0410's trigger), but a
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
              SET status = 'waiting', assigned_room_id = NULL, called_at = NULL
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
