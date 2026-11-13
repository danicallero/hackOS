import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";

import { pool, withTransaction } from "../../db/pool.js";

import { afterCommit } from "../../lib/after-commit.js";

import { audit } from "../../lib/audit.js";

import { isUniqueViolation } from "../../lib/db-errors.js";

import { ConflictError, NotFoundError } from "../../lib/errors.js";

import { broadcast } from "../../lib/sse.js";

import { notifyMany, QUEUE_STAFF_CATEGORY } from "../notifications/service.js";

import { broadcastQueueEventWithMarker, queueFixtureMarker } from "./broadcast.js";

import { lockQueueGroupForEntry } from "./evaluation-lock.js";

import { assertQueueRoomScope } from "./fixture-scope.js";

import { roomChallengeIds } from "./groups.js";

import { findBusyMemberEntry, isRepoIneligibleForJudging } from "./guard.js";

import { writeQueueHistory } from "./history.js";
import {
  assertEntryCanMove,
  assertEntryFixtureScope,
  assertFrom,
  clearWaitingSiblingPrecall,
  lockEntry,
  signalChallengeQueueChanged,
  transitionEntry,
} from "./internal.js";
import { prepareTeamCalled, repoMemberIds } from "./notify.js";
import { placeEntry, placeEntryAtWaitingRank, type RequeuePosition } from "./ordering.js";
import { CLOSE_PRESENTATION_PAUSE_SQL } from "./presentation-clock.js";
import { roomPace } from "./reads.js";
import type { QueueEntryRow } from "./types.js";

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
  opts: { force?: boolean; automatic?: boolean } = {},
): Promise<QueueEntryRow | null> {
  let publishCalled: (() => Promise<void>) | null = null;
  const entry = await withTransaction(async (client): Promise<QueueEntryRow | null> => {
    const stateRes = await client.query(
      `SELECT * FROM room_queue_state WHERE room_id = $1 FOR UPDATE`,
      [roomId],
    );
    if (stateRes.rowCount === 0) throw new NotFoundError("Room not found", { roomId });
    const state = stateRes.rows[0];
    const roomRes = await client.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
    const room = roomRes.rows[0];
    if (!room) throw new NotFoundError("Room not found", { roomId });
    let fixtureMarker: boolean;
    if (actorId != null) {
      fixtureMarker = await assertQueueRoomScope(client, actorId, roomId);
    } else {
      // The automatic pump has no user marker. Resolve the room's complete
      // graph instead of defaulting to the real queue, and fail closed on a
      // mixed or markerless fixture graph.
      const roomMarker = await queueFixtureMarker(client, "room", roomId);
      if (roomMarker === null) {
        throw new ConflictError("Queue fixture markers must match", {
          code: "review_fixture_scope",
          resource: "room",
          resourceId: roomId,
        });
      }
      fixtureMarker = roomMarker;
    }

    if (opts.automatic) {
      const { rows: settingsRows } = await client.query(
        `SELECT (schedule_start_at IS NULL OR schedule_start_at <= now())
                AND (schedule_end_at IS NULL OR schedule_end_at > now()) AS window_open
           FROM queue_settings WHERE id = 1`,
      );
      // H29/H35 (#544): re-check under the room-state lock so a pump that
      // raced a pause/window boundary cannot call a team after the gate shut.
      if (state.is_paused || !settingsRows[0]?.window_open) return null;
    } else if (state.is_paused) {
      throw new ConflictError("Room is paused", { roomId });
    }

    if (!opts.force) {
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS n
           FROM queue_entries qe
           JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
           JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
          WHERE qe.assigned_room_id = $1 AND qe.status = 'called'`,
        [roomId, fixtureMarker],
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
    const challengeIds = await roomChallengeIds(client, roomId, fixtureMarker);
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
      `SELECT qe.* FROM queue_entries qe
        JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
        JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
        WHERE qe.challenge_id = ANY($1) AND qe.status = 'waiting'
          AND NOT EXISTS (
            SELECT 1
              FROM queue_entries sib
              JOIN challenges sib_c ON sib_c.id = sib.challenge_id
                                    AND sib_c.is_test_account = $2
              JOIN repos sib_r ON sib_r.id = sib.repo_id
                               AND sib_r.is_test_account = $2
             WHERE sib.repo_id = qe.repo_id
               AND sib.challenge_id = ANY($1)
               AND sib.id <> qe.id
               AND sib.status IN ('called', 'in_room', 'presenting', 'completed')
          )
        ORDER BY qe.priority DESC, qe.call_count ASC, qe.position ASC NULLS LAST, qe.id ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED`,
      [challengeIds, fixtureMarker],
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
      // H30/H38: an ineligible project is never called; skip, keep position.
      if (await isRepoIneligibleForJudging(client, candidate.repo_id)) continue;
      if (
        await findBusyMemberEntry(client, candidate.repo_id, {
          excludeEntryId: candidate.id,
          fixtureMarker,
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
        if (isUniqueViolation(err)) {
          await client.query(`ROLLBACK TO SAVEPOINT call_next_candidate`);
          continue;
        }
        throw err;
      }
      await client.query(`RELEASE SAVEPOINT call_next_candidate`);
      await clearWaitingSiblingPrecall(client, candidate);
      await writeQueueHistory(client, {
        entryId: entry.id,
        actorId,
        previousStatus: "waiting",
        newStatus: "called",
        action: "call_next",
        metadata: { roomId, forced: Boolean(opts.force) },
      });
      publishCalled = await prepareTeamCalled(client, {
        entryId: entry.id,
        challengeId: entry.challenge_id,
        repoId: entry.repo_id,
        roomId,
        roomName: room.name,
        roomLocation: room.location,
        fixtureMarker,
      });
      return entry;
    }
    return null; // nobody eligible right now — candidates keep their position
  });
  if (entry) {
    // Realtime echo only after commit and off the response path.
    const publish = publishCalled as (() => Promise<void>) | null;
    if (publish) await afterCommit(`call_next ${entry.id} publish`, publish);
    await signalChallengeQueueChanged(entry);
  }
  return entry;
}

// ── H31: notify_enter (no status transition) ────────────────────────────────

export async function notifyEnter(entryId: number, actorId: number): Promise<QueueEntryRow> {
  const { entry, memberIds, eventPayload, fixtureMarker } = await withTransaction(
    async (client) => {
      const entry = await lockEntry(client, entryId);
      const fixtureMarker = await assertEntryFixtureScope(client, actorId, entryId);
      assertFrom(entry, ["called"], "notify_enter");
      await writeQueueHistory(client, {
        entryId,
        actorId,
        previousStatus: entry.status,
        newStatus: entry.status,
        action: "notify_enter",
      });

      const memberIds = await repoMemberIds(client, entry.repo_id, fixtureMarker);
      const { rows: ctxRows } = await client.query(
        `SELECT c.title AS challenge_name, r.name AS room_name, r.location AS room_location,
              (SELECT name FROM repos WHERE id = $3) AS team_name
         FROM challenges c, rooms r
        WHERE c.id = $1 AND r.id = $2`,
        [entry.challenge_id, entry.assigned_room_id, entry.repo_id],
      );
      const challengeName: string = ctxRows[0]?.challenge_name ?? "";
      const roomName: string = ctxRows[0]?.room_name ?? "";
      const roomLocation: string | null = ctxRows[0]?.room_location ?? null;
      const teamName: string = ctxRows[0]?.team_name ?? `#${entry.repo_id}`;

      const { rows: userRows } = await client.query(
        `SELECT id, name FROM users
        WHERE id = ANY($1)
          AND account_state = 'active' AND anonymized_at IS NULL`,
        [memberIds],
      );
      const nameById = new Map<number, string | null>(
        userRows.map((u: { id: number; name: string | null }) => [u.id, u.name]),
      );

      // H31: "que entre" — routed through notify() (H51/H53) so it lands in the
      // inbox and every configured channel, same as the initial call (H29/H38).
      await notifyMany(
        client,
        memberIds.map((userId) => ({
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
          fixtureMarker,
        })),
      );
      const { rows: staffRows } = await client.query(
        `SELECT DISTINCT np.user_id
         FROM notification_preferences np
         JOIN users u ON u.id = np.user_id
        WHERE np.category = $1 AND np.channel = 'push' AND np.enabled = true
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
          AND u.is_test_account = $2`,
        [QUEUE_STAFF_CATEGORY, fixtureMarker],
      );
      await notifyMany(
        client,
        (staffRows as { user_id: number }[]).map((row) => ({
          userId: row.user_id,
          category: QUEUE_STAFF_CATEGORY,
          channels: ["push" as const],
          payload: {
            entryId,
            roomId: entry.assigned_room_id,
            template: "queue.staff.enter",
            vars: { teamName, challengeName, roomName },
          },
          fixtureMarker,
        })),
      );
      return {
        entry,
        memberIds,
        fixtureMarker,
        eventPayload: {
          ...entry,
          team_name: teamName,
          challenge_name: challengeName,
          room_name: roomName,
          room_location: roomLocation,
        },
      };
    },
  );

  await afterCommit(`notify_enter ${entry.id} broadcast`, () =>
    Promise.all([
      broadcastQueueEventWithMarker(fixtureMarker, EVENTS.QUEUE_NOTIFY_ENTER, eventPayload),
      ...memberIds.map((userId) =>
        broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_NOTIFICATION, {
          entryId: entry.id,
          type: "notify_enter",
        }),
      ),
    ]),
  );
  return entry;
}

/** H29: remind a team already in the waiting room to come to this room and wait. */
export async function remindWaitingRoom(entryId: number, actorId: number): Promise<QueueEntryRow> {
  let publish: (() => Promise<void>) | null = null;
  const entry = await withTransaction(async (client) => {
    const entry = await lockEntry(client, entryId);
    const fixtureMarker = await assertEntryFixtureScope(client, actorId, entryId);
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
    publish = await prepareTeamCalled(client, {
      entryId,
      challengeId: entry.challenge_id,
      repoId: entry.repo_id,
      roomId: entry.assigned_room_id,
      roomName: room.name,
      roomLocation: room.location,
      fixtureMarker,
    });
    return entry;
  });
  const after = publish as (() => Promise<void>) | null;
  if (after) await afterCommit(`remind_waiting_room ${entryId} publish`, after);
  return entry;
}

// ── H32: bring_in / start / complete ────────────────────────────────────────

export async function bringIn(entryId: number, actorId: number): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, ["called"], "bring_in");
    if (!entry.assigned_room_id) throw new ConflictError("Entry has no assigned room", { entryId });

    let updated: QueueEntryRow;
    try {
      const res = await client.query(
        `UPDATE queue_entries
            SET status = 'in_room', room_entered_at=now(), precalled_at = NULL
          WHERE id = $1
          RETURNING *`,
        [entryId],
      );
      updated = res.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
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
  });
}

export async function startPresentation(entryId: number, actorId: number): Promise<QueueEntryRow> {
  // #926: the frozen goal is computed before taking any lock, from an
  // unlocked snapshot, and never blocks the start: a reassigned room or a
  // pace failure falls back to the group's capped target inside the lock.
  const snapshot = (
    await pool.query<{ assigned_room_id: number | null; challenge_id: number; marker: boolean }>(
      `SELECT qe.assigned_room_id, qe.challenge_id, r.is_test_account AS marker
         FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id
        WHERE qe.id = $1`,
      [entryId],
    )
  ).rows[0];
  const pacedSeconds = snapshot?.assigned_room_id
    ? await roomPace(
        snapshot.assigned_room_id,
        snapshot.challenge_id,
        pool,
        snapshot.marker,
        entryId,
      )
        .then((pace) => Math.round(pace.effectiveMinutesPerTeam * 60))
        .catch(() => null)
    : null;
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, ["in_room"], "start");
    const totalSeconds =
      pacedSeconds !== null && entry.assigned_room_id === snapshot?.assigned_room_id
        ? pacedSeconds
        : ((
            await client.query<{ seconds: number | null }>(
              `SELECT LEAST(min(c.target_seconds_per_team), min(c.max_presentation_seconds))::int AS seconds
                 FROM queue_group_challenges own
                 JOIN queue_group_challenges sibling ON sibling.queue_group_id = own.queue_group_id
                 JOIN challenges c ON c.id = sibling.challenge_id
                WHERE own.challenge_id = $1`,
              [entry.challenge_id],
            )
          ).rows[0]?.seconds ?? null);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'presenting', presentation_started_at = now(), precalled_at = NULL,
              presentation_paused_at = NULL, presentation_paused_seconds = 0,
              presentation_total_seconds = $2
        WHERE id = $1
        RETURNING *`,
      [entryId, totalSeconds],
    );
    await writeQueueHistory(client, {
      audit: false,
      entryId,
      actorId,
      previousStatus: "in_room",
      newStatus: "presenting",
      action: "start",
    });
    await audit(client, {
      actorId,
      action: "start",
      entityType: "queue_entry",
      entityId: entryId,
      before: { status: entry.status },
      after: {
        status: "presenting",
        presentationTotalSeconds: res.rows[0].presentation_total_seconds,
      },
    });
    return res.rows[0];
  });
}

// #926: timer pause is independent of the H35 room pause and keeps occupancy.
export async function setPresentationPaused(
  entryId: number,
  actorId: number,
  paused: boolean,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, ["presenting"], paused ? "pause_timer" : "resume_timer");
    if (Boolean(entry.presentation_paused_at) === paused) {
      throw new ConflictError(
        paused ? "Presentation timer is already paused" : "Presentation timer is already running",
      );
    }
    const { rows } = await client.query(
      paused
        ? `UPDATE queue_entries SET presentation_paused_at = now() WHERE id = $1 RETURNING *`
        : `UPDATE queue_entries
              SET presentation_paused_seconds = presentation_paused_seconds +
                    GREATEST(0, EXTRACT(EPOCH FROM (now() - presentation_paused_at))),
                  presentation_paused_at = NULL
            WHERE id = $1 RETURNING *`,
      [entryId],
    );
    const action = paused ? "pause_timer" : "resume_timer";
    await writeQueueHistory(client, {
      audit: false,
      entryId,
      actorId,
      previousStatus: "presenting",
      newStatus: "presenting",
      action,
    });
    await audit(client, {
      actorId,
      action,
      entityType: "queue_entry",
      entityId: entryId,
      before: { paused: !paused },
      after: { paused },
    });
    return rows[0];
  });
}

export async function completePresentation(
  entryId: number,
  actorId: number,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    // Manual completion is also an evaluation boundary. Match structural
    // queue edits' group-then-entry lock order before setting `completed`.
    await lockQueueGroupForEntry(client, entryId);
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, ["presenting"], "complete");
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'completed', completed_at = now(), precalled_at = NULL,
              ${CLOSE_PRESENTATION_PAUSE_SQL}
        WHERE id = $1
        RETURNING *`,
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
  });
}

// ── H33: send_back_to_waiting / requeue / re_enter ──────────────────────────

/** in_room|presenting -> called, TOP of the challenge's shared queue. */
export async function sendBackToWaiting(
  entryId: number,
  actorId: number,
  reason?: string,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    await assertEntryFixtureScope(client, actorId, entryId);
    assertFrom(entry, ["in_room", "presenting"], "send_back_to_waiting");
    const position = await placeEntry(client, entry.challenge_id, entryId, "top");
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'called', position = $1, called_at = now(), precalled_at = NULL,
              presentation_started_at = NULL, presentation_paused_at = NULL, presentation_paused_seconds = 0, presentation_total_seconds = NULL, room_entered_at = NULL
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
  });
}

/** called -> waiting, position top|bottom (plan/07 §4). */
export async function requeue(
  entryId: number,
  actorId: number,
  position: RequeuePosition,
  reason?: string,
): Promise<QueueEntryRow> {
  return transitionEntry(async (client) => {
    const entry = await lockEntry(client, entryId);
    const fixtureMarker = await assertEntryFixtureScope(client, actorId, entryId);
    await assertEntryCanMove(client, entry, fixtureMarker);
    assertFrom(entry, ["called"], "requeue");
    // "top" from the waiting room goes right behind the head of the queue (same as
    // move_to_top): the head takes the slot this frees, instead of the same team
    // being called straight back in by the top-up.
    const pos =
      position === "top"
        ? await placeEntryAtWaitingRank(client, entry.challenge_id, entryId, 2)
        : await placeEntry(client, entry.challenge_id, entryId, position);
    const res = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL, called_at = NULL,
              precalled_at = NULL
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
  });
}
