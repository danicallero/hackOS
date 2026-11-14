import { ERROR_REASONS } from "@hackos/shared/error-reasons";

import { withTransaction } from "../../db/pool.js";

import { afterCommit } from "../../lib/after-commit.js";

import { audit } from "../../lib/audit.js";

import { isUniqueViolation } from "../../lib/db-errors.js";

import { ConflictError, NotFoundError } from "../../lib/errors.js";

import { lockQueueGroupForEntry } from "./evaluation-lock.js";

import { assertQueueRoomScope } from "./fixture-scope.js";

import { findBusyMemberEntry, isRepoIneligibleForJudging } from "./guard.js";

import { writeQueueHistory } from "./history.js";
import {
  assertEntryCanMove,
  assertEntryFixtureScope,
  assertFrom,
  broadcastEntry,
  clearWaitingSiblingPrecall,
  lockEntry,
  signalChallengeQueueChanged,
  transitionEntry,
} from "./internal.js";
import { prepareTeamCalled } from "./notify.js";
import { placeEntry, placeEntryAtWaitingRank, type RequeuePosition } from "./ordering.js";
import type { QueueEntryRow } from "./types.js";

const RE_ENTER_FROM = ["completed", "cancelled", "disqualified"];

/** Manual + audited recovery of a "forgotten" team from a terminal state (H33). */
export async function reEnter(
  entryId: number,
  actorId: number,
  position: RequeuePosition,
  reason: string,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, RE_ENTER_FROM, "re_enter");
    const pos = await placeEntry(client, entry.challenge_id, entryId, position);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              precalled_at = NULL, presentation_started_at = NULL, presentation_paused_at = NULL, presentation_paused_seconds = 0, presentation_total_seconds = NULL, room_entered_at = NULL, completed_at = NULL
        WHERE id = $2
        RETURNING *`,
      [pos, entryId],
    );
    const updated = res.rows[0];
    await writeQueueHistory(client, {
      audit: false,
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
  });
}

// ── H34: no_show (human decision) / skip (no penalty) ───────────────────────

const NO_SHOW_FROM = ["called", "in_room"];

/** called|in_room -> waiting (bottom), call_count++ (ladder), never eliminates. */
export async function markNoShow(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, NO_SHOW_FROM, "no_show");
    const position = await placeEntry(client, entry.challenge_id, entryId, "bottom");
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              precalled_at = NULL, presentation_started_at = NULL, presentation_paused_at = NULL, presentation_paused_seconds = 0, presentation_total_seconds = NULL, room_entered_at = NULL, call_count = call_count + 1
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
  });
}

const MOVE_TO_POSITION_FROM = ["waiting", "called"];

/**
 * Put a waiting/called team at an explicit place in its queue_group's queue.
 * The rank is 1-based and clamped into range, and counts only `waiting`
 * entries — the entry ends up `waiting`, so `rank` is exactly the "teams
 * ahead of entering the waiting room" number every surface displays (see
 * `ordering.ts`'s `placeEntryAtWaitingRank`), even when `called` entries are
 * interleaved in the underlying combined ordering.
 */
export async function moveToPosition(
  entryId: number,
  actorId: number,
  rank: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    const fixtureMarker = await assertEntryFixtureScope(client, actorId, entryId);
    await assertEntryCanMove(client, entry, fixtureMarker);
    assertFrom(entry, MOVE_TO_POSITION_FROM, "move_to_position");
    const position = await placeEntryAtWaitingRank(client, entry.challenge_id, entryId, rank);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              precalled_at = NULL, presentation_started_at = NULL, presentation_paused_at = NULL, presentation_paused_seconds = 0, presentation_total_seconds = NULL, room_entered_at = NULL
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
  });
}

const SKIP_FROM = ["waiting", "called"];

/** Staff sends a team to the end of the queue at their own request — no ladder penalty. */
export async function skipToEnd(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    const fixtureMarker = await assertEntryFixtureScope(client, actorId, entryId);
    await assertEntryCanMove(client, entry, fixtureMarker);
    assertFrom(entry, SKIP_FROM, "skip");
    const position = await placeEntry(client, entry.challenge_id, entryId, "bottom");
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              precalled_at = NULL, presentation_started_at = NULL, presentation_paused_at = NULL, presentation_paused_seconds = 0, presentation_total_seconds = NULL, room_entered_at = NULL
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
  });
}

const MOVE_TOP_FROM = ["waiting", "called"];

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
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    const fixtureMarker = await assertEntryFixtureScope(client, actorId, entryId);
    await assertEntryCanMove(client, entry, fixtureMarker);
    assertFrom(entry, MOVE_TOP_FROM, "move_to_top");
    // A team leaving the waiting room goes right behind the head of the queue: the head takes
    // the slot this move frees first, instead of the same team being called straight back in.
    const position =
      entry.status === "called"
        ? await placeEntryAtWaitingRank(client, entry.challenge_id, entryId, 2)
        : await placeEntry(client, entry.challenge_id, entryId, "top");
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              precalled_at = NULL, presentation_started_at = NULL, presentation_paused_at = NULL, presentation_paused_seconds = 0, presentation_total_seconds = NULL, room_entered_at = NULL
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
      metadata: { position: entry.status === "called" ? "behind_head" : "top" },
    });
    return res.rows[0];
  });
}

const DISQUALIFY_FROM = ["waiting", "called", "in_room", "presenting"];

/** Manual, audited, for repeated no-shows (H34). Terminal — no automatic path back in. */
export async function disqualify(
  entryId: number,
  actorId: number,
  reason: string,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, DISQUALIFY_FROM, "disqualify");
    const res = await client.query(
      `UPDATE queue_entries SET status = 'disqualified', precalled_at = NULL WHERE id = $1 RETURNING *`,
      [entryId],
    );
    await writeQueueHistory(client, {
      audit: false,
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
  });
}

/** Admin cleanup (repo withdrawn, duplicate, etc). Not one of the H29-H40 actions but low-risk to expose. */
export async function cancelEntry(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, ["waiting", "called"], "cancel");
    const res = await client.query(
      `UPDATE queue_entries SET status = 'cancelled', precalled_at = NULL WHERE id = $1 RETURNING *`,
      [entryId],
    );
    await writeQueueHistory(client, {
      audit: false,
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
  });
}

// ── manual call (any team, any position, H37 search-and-bring-in) ──────────

export async function manualCall(
  entryId: number,
  actorId: number,
  targetStatus: "called" | "in_room",
  roomId: number,
  reason: string | undefined,
): Promise<QueueEntryRow> {
  let publishCalled: (() => Promise<void>) | null = null;
  let scopedMarker: boolean | null = null;
  const result = await withTransaction(async (client) => {
    // Match structural queue mutations: lock the queue group before its
    // entries so a concurrent merge cannot move the challenge between the
    // entry lock and the target-room validation.
    await lockQueueGroupForEntry(client, entryId);
    const entry = await lockEntry(client, entryId);
    const fixtureMarker = await assertEntryFixtureScope(client, actorId, entryId);
    scopedMarker = fixtureMarker;
    await assertQueueRoomScope(client, actorId, roomId);
    const entryGroup = await client.query<{ queue_group_id: number }>(
      `SELECT queue_group_id
         FROM queue_group_challenges
        WHERE challenge_id = $1
        FOR SHARE`,
      [entry.challenge_id],
    );
    const targetRoom = await client.query<{
      id: number;
      name: string;
      location: string | null;
      queue_group_id: number | null;
    }>(
      `SELECT r.id, r.name, r.location, rqg.queue_group_id
         FROM rooms r
         LEFT JOIN room_queue_groups rqg ON rqg.room_id = r.id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [roomId],
    );
    const room = targetRoom.rows[0];
    if (!room) throw new NotFoundError("Room not found", { roomId });
    const lockedMapping = await client.query<{ queue_group_id: number }>(
      `SELECT queue_group_id
         FROM room_queue_groups
        WHERE room_id = $1
        FOR UPDATE`,
      [roomId],
    );
    room.queue_group_id = lockedMapping.rows[0]?.queue_group_id ?? null;
    const entryGroupId = entryGroup.rows[0]?.queue_group_id ?? null;
    if (entryGroupId == null || room.queue_group_id !== entryGroupId) {
      throw new ConflictError("Room does not serve this queue", {
        entryId,
        roomId,
        queueGroupId: entryGroupId,
      });
    }
    if (entry.status === targetStatus) {
      throw new ConflictError(`Entry is already ${targetStatus}`, { entryId });
    }
    if (targetStatus === "called" && entry.status !== "waiting") {
      throw new ConflictError("Only a waiting team can be sent to a waiting room", { entryId });
    }
    if (targetStatus === "in_room" && !["waiting", "called"].includes(entry.status)) {
      throw new ConflictError("Only a waiting or called team can enter a room", { entryId });
    }
    if (
      targetStatus === "in_room" &&
      entry.status === "called" &&
      entry.assigned_room_id != null &&
      entry.assigned_room_id !== roomId
    ) {
      throw new ConflictError("Entry is assigned to another room", {
        entryId,
        assignedRoomId: entry.assigned_room_id,
        roomId,
      });
    }
    if (await isRepoIneligibleForJudging(client, entry.repo_id)) {
      throw new ConflictError("Project is not eligible for judging", {
        entryId,
        repoId: entry.repo_id,
      });
    }
    if (
      await findBusyMemberEntry(client, entry.repo_id, {
        excludeEntryId: entry.id,
        fixtureMarker,
      })
    ) {
      throw new ConflictError("Team has a member busy in another room (H30)", {
        entryId,
        code: ERROR_REASONS.TEAM_MEMBER_BUSY,
      });
    }
    let updated: QueueEntryRow;
    try {
      const res = await client.query(
        `UPDATE queue_entries
            SET status = $1, assigned_room_id = $2,
                called_at = COALESCE(called_at, now()), precalled_at = NULL
          WHERE id = $3
          RETURNING *`,
        [targetStatus, roomId, entryId],
      );
      updated = res.rows[0];
    } catch (err) {
      if (isUniqueViolation(err, "one_active_entry_per_repo")) {
        throw new ConflictError("Team has a member busy in another room (H30)", {
          entryId,
          code: ERROR_REASONS.TEAM_MEMBER_BUSY,
        });
      }
      if (isUniqueViolation(err)) {
        throw new ConflictError("Room already has an active team", { roomId });
      }
      throw err;
    }

    await clearWaitingSiblingPrecall(client, entry);

    await writeQueueHistory(client, {
      audit: false,
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
      publishCalled = await prepareTeamCalled(client, {
        entryId: updated.id,
        challengeId: updated.challenge_id,
        repoId: updated.repo_id,
        roomId,
        roomName: room.name,
        roomLocation: room.location,
        fixtureMarker,
      });
    }
    return updated;
  });
  // targetStatus === "called" publishes QUEUE_TEAM_CALLED to the queue topic
  // (prepareTeamCalled) — plan/07 invariant 5, one broadcast per action. The
  // publish runs after commit, off the response path.
  const publish = publishCalled as (() => Promise<void>) | null;
  if (publish) await afterCommit(`manual_call ${entryId} publish`, publish);
  if (result.status === "called") return signalChallengeQueueChanged(result);
  return broadcastEntry(result, scopedMarker);
}
