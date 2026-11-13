import { ERROR_REASONS } from "@hackos/shared/error-reasons";

import { EVENTS } from "@hackos/shared/events";

import type pg from "pg";

import { pool, withTransaction } from "../../db/pool.js";

import { afterCommit } from "../../lib/after-commit.js";

import { ConflictError, NotFoundError } from "../../lib/errors.js";

import { broadcastQueueEventWithMarker } from "./broadcast.js";

import { assertQueueEntryScope } from "./fixture-scope.js";

import { findBusyMemberEntry } from "./guard.js";

import { notifyChallengeQueueChanged } from "./notify.js";

import type { QueueEntryRow } from "./types.js";

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
export async function lockEntry(client: pg.PoolClient, entryId: number): Promise<QueueEntryRow> {
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

/**
 * Entry transitions must re-check the fixture boundary after the entry and
 * its queue-group siblings are locked. Route middleware is useful for early
 * rejection, but this transaction-local check is the guard that protects the
 * actual mutation from stale or guessed ids.
 */
export async function assertEntryFixtureScope(
  client: pg.PoolClient,
  actorId: number,
  entryId: number,
): Promise<boolean> {
  const marker = await assertQueueEntryScope(client, actorId, entryId);
  scopeMarkers.set(client, marker);
  return marker;
}

/**
 * Marker verified by `assertEntryFixtureScope` on a transaction's client. It
 * equals the entry's challenge, repo and queue-group marker (the assertion
 * fails otherwise), so the post-commit broadcast needs no marker re-lookup.
 */
const scopeMarkers = new WeakMap<pg.PoolClient, boolean>();

/**
 * Run an entry transition and publish its realtime signal after commit with
 * the marker the transaction already verified. No scope assertion in the
 * callback means a null marker, which fails closed (no operator broadcast).
 */
export async function transitionEntry(
  work: (client: pg.PoolClient) => Promise<QueueEntryRow>,
): Promise<QueueEntryRow> {
  let marker: boolean | null = null;
  const entry = await withTransaction(async (client) => {
    scopeMarkers.delete(client);
    const result = await work(client);
    marker = scopeMarkers.get(client) ?? null;
    scopeMarkers.delete(client);
    return result;
  });
  return broadcastEntry(entry, marker);
}

/**
 * Post-commit realtime signal for a queue action. Runs off the response path
 * (`afterCommit`): the write is already durable, and the SSE publish plus the
 * debounced participant-invalidation enqueue are several Valkey round trips
 * the caller does not need to wait for.
 */
export async function broadcastEntry(
  entry: QueueEntryRow,
  marker: boolean | null,
): Promise<QueueEntryRow> {
  await afterCommit(`queue entry ${entry.id} broadcast`, () =>
    Promise.all([
      broadcastQueueEventWithMarker(marker, EVENTS.QUEUE_ENTRY_CHANGED, entry),
      notifyChallengeQueueChanged(pool, entry.challenge_id),
    ]),
  );
  return entry;
}

/**
 * Participant-facing read-model signal only, no `SSE_TOPICS.QUEUE` broadcast.
 * Used where `notifyTeamCalled` already broadcast `QUEUE_TEAM_CALLED` to the
 * queue topic for this same action — plan/07 invariant 5 allows exactly one
 * queue-topic broadcast per action, so this avoids doubling it up.
 */
export async function signalChallengeQueueChanged(entry: QueueEntryRow): Promise<QueueEntryRow> {
  await afterCommit(`queue entry ${entry.id} participant signal`, () =>
    notifyChallengeQueueChanged(pool, entry.challenge_id),
  );
  return entry;
}

export function assertFrom(entry: QueueEntryRow, allowed: string[], action: string): void {
  if (!allowed.includes(entry.status)) {
    throw new ConflictError(`Cannot ${action} from status "${entry.status}"`, {
      status: entry.status,
      allowed,
    });
  }
}

/**
 * A pre-call is for one logical team, not one physical queue-entry row. Once
 * one sibling is called, clear any warning markers on the remaining waiting
 * siblings so a later requeue/re-entry can begin a fresh call cycle.
 */
export async function clearWaitingSiblingPrecall(
  client: pg.PoolClient,
  entry: Pick<QueueEntryRow, "challenge_id" | "repo_id">,
): Promise<void> {
  await client.query(
    `UPDATE queue_entries sibling
        SET precalled_at = NULL
      WHERE sibling.repo_id = $1
        AND sibling.status = 'waiting'
        AND sibling.challenge_id IN (
          SELECT qgc.challenge_id
            FROM queue_group_challenges qgc
           WHERE qgc.queue_group_id = (
             SELECT own.queue_group_id
               FROM queue_group_challenges own
              WHERE own.challenge_id = $2
           )
        )`,
    [entry.repo_id, entry.challenge_id],
  );
}

/** Statuses in which a team is actively being evaluated, not merely waiting at the door. */
const EVALUATING_STATUSES = ["in_room", "presenting"];

/**
 * Reordering is safe only while this entry is not being evaluated and none
 * of the team's members is being evaluated in another room. A called entry
 * may still be moved out of its own waiting room; the current entry is
 * therefore excluded from the shared-member guard. A move never calls a
 * team, so project eligibility (a call-time rule) does not block it (#931).
 */
export async function assertEntryCanMove(
  client: pg.PoolClient,
  entry: QueueEntryRow,
  fixtureMarker?: boolean,
): Promise<void> {
  const busy = await findBusyMemberEntry(client, entry.repo_id, {
    excludeEntryId: entry.id,
    statuses: EVALUATING_STATUSES,
    fixtureMarker,
  });
  if (!busy) return;
  throw new ConflictError(
    busy.roomName ? `Busy in ${busy.roomName}` : "Team has a member busy in another room (H30)",
    {
      entryId: entry.id,
      repoId: entry.repo_id,
      code: ERROR_REASONS.TEAM_MEMBER_BUSY,
      ...(busy.roomName ? { roomName: busy.roomName } : {}),
      status: busy.status,
    },
  );
}
