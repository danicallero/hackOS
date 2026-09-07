import type { Queryable } from "../../db/pool.js";
import { GROUP_SIBLING_CHALLENGE_IDS_SQL } from "./groups.js";

/**
 * Queue ordering (plan/07 §4).
 *
 * **`queue_entries.position` is a dense rank: 1..N over the active
 * (`waiting` | `called`) entries of one queue_group, no gaps, never zero,
 * never negative.** This is the *physical* ordering key: it drives
 * `call_next`'s candidate order, pause/reinjection placement, and every
 * `placeEntry` move — nothing here changes when a team's status flips
 * between `waiting` and `called`.
 *
 * It is deliberately **not** what any surface displays as "queue position."
 * A team's displayed number is "how many teams are ahead of it before it
 * enters the waiting room" — a rank over `waiting` entries only, computed at
 * read time (see `reads.ts`'s waiting-only rank helper, shared by
 * `myQueueStatus`, `waitingQueueView` and `queueGroupQueue`). `called`
 * entries have already entered the waiting room, so they neither get a
 * displayed number nor count toward anyone else's — and because H30 skips
 * leave a busy team's `position` untouched while calling the next eligible
 * team, `called` and `waiting` rows end up genuinely interleaved by
 * `position`, not front-loaded, so the display rank cannot be derived by
 * subtracting a called-count from the stored column.
 *
 * This replaces a sparse-sort-key scheme where "move to top" wrote
 * `min - 1` and "move to bottom" wrote `max + 1`, leaving the queue at
 * positions like `-3, -2, 1, 4, 9` after a few moves: correct as an ordering,
 * unreadable as a position, and a source of "why is this team at #-2" bug
 * reports. Every mutation now renumbers the group, so the invariant holds
 * after *any* sequence of moves rather than only after an explicit compaction.
 *
 * H46: the scope of that ordering is the challenge's **queue_group**, not the
 * challenge — a shared queue is one queue with one ordering. Callers pass a
 * `challengeId` (that is what a `queue_entries` row carries; its schema is
 * deliberately untouched) and the group is resolved from it. For a 1:1 group
 * the group is the challenge, so nothing about a single-challenge enterprise
 * changes.
 *
 * Every function here must run inside a transaction that already holds the
 * entry lock (`SELECT ... FOR UPDATE`), so two concurrent moves serialise
 * instead of interleaving their renumbering.
 */

export type RequeuePosition = "top" | "bottom";

/** Where an entry should end up. A rank is 1-based and clamped into range. */
export type QueuePlacement = RequeuePosition | { rank: number };

/**
 * The group's active entries in queue order, locked for the transaction.
 * Ordered by `id` for the lock acquisition (a stable order across concurrent
 * callers cannot deadlock) and re-sorted by position afterwards.
 */
async function lockedGroupOrder(
  client: Queryable,
  challengeId: number,
): Promise<Array<{ id: number; position: number | null; status: string }>> {
  // `status` is the `queue_status` enum, so the active set is spelled out as
  // literals rather than bound as a text[] parameter.
  await client.query(
    `SELECT id FROM queue_entries
      WHERE challenge_id IN (${GROUP_SIBLING_CHALLENGE_IDS_SQL})
        AND status IN ('waiting', 'called')
      ORDER BY id
      FOR UPDATE`,
    [challengeId],
  );
  const { rows } = await client.query(
    `SELECT id, position, status FROM queue_entries
      WHERE challenge_id IN (${GROUP_SIBLING_CHALLENGE_IDS_SQL})
        AND status IN ('waiting', 'called')
      ORDER BY position ASC NULLS LAST, id ASC`,
    [challengeId],
  );
  return rows.map((row: { id: number; position: number | null; status: string }) => ({
    id: Number(row.id),
    position: row.position === null ? null : Number(row.position),
    status: row.status,
  }));
}

/** Write `orderedIds[i]` -> position i+1 in one statement. */
async function renumber(client: Queryable, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await client.query(
    `UPDATE queue_entries qe
        SET position = target.position
       FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY ord) AS position
           FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)
       ) target
      WHERE qe.id = target.id
        AND qe.position IS DISTINCT FROM target.position`,
    [orderedIds],
  );
}

/**
 * Put `entryId` at `placement` within its queue_group and renumber the whole
 * group to a dense 1..N. Returns the entry's new position.
 *
 * The entry does not have to be active yet — re-entering a completed team
 * runs through here too, so the caller can set the row's status in the same
 * transaction and rely on the position already being right.
 */
export async function placeEntry(
  client: Queryable,
  challengeId: number,
  entryId: number,
  placement: QueuePlacement,
): Promise<number> {
  const order = await lockedGroupOrder(client, challengeId);
  const ids = order.map((row) => row.id).filter((id) => id !== entryId);

  let index: number;
  if (placement === "top") index = 0;
  else if (placement === "bottom") index = ids.length;
  else index = Math.min(Math.max(placement.rank - 1, 0), ids.length);

  ids.splice(index, 0, entryId);
  await renumber(client, ids);
  return index + 1;
}

/**
 * Put `entryId` at the `waitingRank`-th `waiting` slot within its
 * queue_group, so the number an operator submits matches the "teams ahead of
 * entering the waiting room" number every surface displays — even when
 * `called` entries are interleaved in the underlying combined ordering.
 * `called` entries don't count toward the rank but keep their own relative
 * slot: `entryId` is spliced in right after the `(waitingRank - 1)`th
 * `waiting` entry, skipping over any `called` rows in between. Renumbers the
 * whole group and returns the entry's new (combined) `position`.
 */
export async function placeEntryAtWaitingRank(
  client: Queryable,
  challengeId: number,
  entryId: number,
  waitingRank: number,
): Promise<number> {
  const order = await lockedGroupOrder(client, challengeId);
  const rest = order.filter((row) => row.id !== entryId);

  // `index` is where `entryId` gets spliced into `rest`. Default: after
  // everyone, becoming the last waiting entry (target exceeds how many
  // waiting entries exist). Otherwise, splice in right before the
  // `target`-th waiting entry — the `target - 1` waiting entries before it
  // (and any interleaved `called` rows) keep their place, so `entryId`
  // becomes exactly the `target`-th waiting entry.
  const target = Math.max(1, Math.trunc(waitingRank));
  let index = rest.length;
  let waitingSeen = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i]?.status === "waiting") {
      waitingSeen += 1;
      if (waitingSeen === target) {
        index = i;
        break;
      }
    }
  }

  const ids = rest.map((row) => row.id);
  ids.splice(index, 0, entryId);
  await renumber(client, ids);
  return index + 1;
}

/**
 * Put several entries at the top at once while preserving their relative
 * order (plan/07 §4: "el que más tiempo lleve en called se pone al tope").
 * `orderedIds` must already be sorted so the entry that should end up topmost
 * is first.
 */
export async function placeEntriesOnTop(
  client: Queryable,
  challengeId: number,
  orderedIds: number[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  const order = await lockedGroupOrder(client, challengeId);
  const moving = new Set(orderedIds);
  const rest = order.map((row) => row.id).filter((id) => !moving.has(id));
  await renumber(client, [...orderedIds, ...rest]);
}

/**
 * Restore the 1..N invariant for a group without moving anyone — after a
 * removal (complete, cancel, disqualify, call) leaves a gap, or after a merge
 * folds two independently-numbered queues into one key space.
 */
export async function compactQueueGroupPositions(
  client: Queryable,
  challengeId: number,
): Promise<void> {
  const order = await lockedGroupOrder(client, challengeId);
  await renumber(
    client,
    order.map((row) => row.id),
  );
}

/** The rank an entry would take at the back of its queue_group's queue. */
export async function nextBottomPosition(client: Queryable, challengeId: number): Promise<number> {
  const order = await lockedGroupOrder(client, challengeId);
  return order.length + 1;
}

/** How many teams are active in the challenge's queue_group. */
export async function groupQueueLength(client: Queryable, challengeId: number): Promise<number> {
  const order = await lockedGroupOrder(client, challengeId);
  return order.length;
}
