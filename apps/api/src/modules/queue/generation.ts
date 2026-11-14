import type pg from "pg";

import { withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { ConflictError, NotFoundError } from "../../lib/errors.js";

import { anyEvaluationStarted } from "./evaluation-lock.js";

import {
  assertQueueChallengeScope,
  assertQueueGroupScope,
  assertQueueRepoScope,
} from "./fixture-scope.js";

import { writeQueueHistory } from "./history.js";
import { broadcastEntry } from "./internal.js";
import { compactQueueGroupPositions, placeEntry } from "./ordering.js";
import type { QueueEntryRow } from "./types.js";

// ── enqueue (admin) ──────────────────────────────────────────────────────────

type QueueGenerationOutcome = {
  entry: QueueEntryRow;
  inserted: boolean;
  revived: boolean;
};

type PresentationTimingPreference = "no_preference" | "early" | "middle" | "late";

/**
 * A project's timing is a best-effort input only while a queue is first
 * populated.  Once it has entries, their order is operational state: a later
 * generation must append/revive without moving a team an operator has already
 * ordered. Inheriting a planning preference remains the projects boundary (#854).
 */
async function presentationTimingPreferences(
  client: pg.PoolClient,
  repoIds: number[],
): Promise<Map<number, PresentationTimingPreference>> {
  if (repoIds.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT id, presentation_timing_preference
       FROM repos
      WHERE id = ANY($1::int[])`,
    [repoIds],
  );
  return new Map(
    rows.map(
      (row: { id: number; presentation_timing_preference: PresentationTimingPreference }) => [
        Number(row.id),
        row.presentation_timing_preference,
      ],
    ),
  );
}

/**
 * Preserve the default generation order for teams without a preference, while
 * placing opted-in teams near the beginning, midpoint, or end of a fresh
 * queue. Stable ties deliberately make this a soft preference rather than a
 * scheduling promise.
 */
function orderInitialQueueRepos(
  repoIds: number[],
  preferences: Map<number, PresentationTimingPreference>,
): number[] {
  const lastIndex = Math.max(repoIds.length - 1, 0);
  return repoIds
    .map((repoId, index) => {
      const preference = preferences.get(repoId) ?? "no_preference";
      const target =
        preference === "early"
          ? -1
          : preference === "middle"
            ? lastIndex / 2
            : preference === "late"
              ? lastIndex + 1
              : index;
      return { repoId, index, target };
    })
    .sort((left, right) => left.target - right.target || left.index - right.index)
    .map(({ repoId }) => repoId);
}

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
  // Keep the shared queue-group path subject to the same marker boundary as
  // the explicit challenge endpoint. Prize-derived repo ids are global, so a
  // tag lookup can otherwise mix real and synthetic graphs.
  await assertQueueChallengeScope(client, actorId, challengeId);
  await assertQueueRepoScope(client, actorId, repoId);
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
              called_at = NULL, presentation_started_at = NULL, presentation_paused_at = NULL, presentation_paused_seconds = 0, presentation_total_seconds = NULL, room_entered_at = NULL, completed_at = NULL,
              precalled_at = NULL
        WHERE id = $1
        RETURNING *`,
      [entry.id],
    );
    const position = await placeEntry(client, challengeId, entry.id, "bottom");
    const positioned = await client.query(`SELECT * FROM queue_entries WHERE id = $1`, [entry.id]);
    await writeQueueHistory(client, {
      audit: false,
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
    audit: false,
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

async function challengeProjectIds(
  client: pg.PoolClient,
  challengeId: number,
  fixtureMarker = false,
): Promise<number[]> {
  const { rows } = await client.query(
    `SELECT pc.repo_id FROM project_challenges pc JOIN repos r ON r.id=pc.repo_id WHERE pc.challenge_id=$1 AND r.is_test_account=$2 AND r.submission_status='submitted'`,
    [challengeId, fixtureMarker],
  );
  return rows.map((row) => Number(row.repo_id));
}

export async function enqueueChallenge(
  challengeId: number,
  actorId: number,
  repoIds?: number[],
): Promise<{ inserted: number[]; alreadyQueued: number[] }> {
  let scopedMarker: boolean | null = null;
  const result = await withTransaction(async (client) => {
    // H54: this endpoint accepts caller-supplied challenge/repo ids, so the
    // capability check alone is not enough to keep synthetic queue graphs
    // out of ordinary operators' writes. Validate the challenge and every
    // repo before creating any entry; the same transaction also covers the
    // prize-derived repo list used when the body omits repoIds.
    const fixtureMarker = await assertQueueChallengeScope(client, actorId, challengeId);
    scopedMarker = fixtureMarker;
    let ids = repoIds;
    if (!ids || ids.length === 0) {
      ids = await challengeProjectIds(client, challengeId, fixtureMarker);
    }
    for (const repoId of ids) {
      await assertQueueRepoScope(client, actorId, repoId);
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
    await broadcastEntry(entry, scopedMarker);
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
  let scopedMarker: boolean | null = null;
  const result = await withTransaction(async (client) => {
    const group = await client.query(`SELECT id FROM queue_groups WHERE id = $1 FOR UPDATE`, [
      queueGroupId,
    ]);
    if (group.rowCount === 0) {
      throw new NotFoundError("Queue group not found", { queueGroupId });
    }
    const fixtureMarker = await assertQueueGroupScope(client, actorId, queueGroupId);
    scopedMarker = fixtureMarker;
    const { rows: challenges } = await client.query(
      `SELECT c.id FROM queue_group_challenges qgc
        JOIN challenges c ON c.id = qgc.challenge_id
       WHERE qgc.queue_group_id = $1 ORDER BY c.id`,
      [queueGroupId],
    );
    // The group row lock serializes generation. Read whether this is a fresh
    // queue before creating entries so a concurrent generation cannot move a
    // queue that has become operational between this check and insertion.
    const existingEntries = await client.query(
      `SELECT 1
         FROM queue_entries qe
         JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
        WHERE qgc.queue_group_id = $1
        LIMIT 1`,
      [queueGroupId],
    );
    const candidates = new Map<number, number[]>();
    for (const challenge of challenges as Array<{ id: number }>) {
      const challengeId = Number(challenge.id);
      const repoIds = await challengeProjectIds(client, challengeId, fixtureMarker);
      for (const repoId of repoIds) {
        const challengeIds = candidates.get(repoId) ?? [];
        challengeIds.push(challengeId);
        candidates.set(repoId, challengeIds);
      }
    }
    const repoIds = [...candidates.keys()];
    const orderedRepoIds =
      existingEntries.rowCount === 0
        ? orderInitialQueueRepos(repoIds, await presentationTimingPreferences(client, repoIds))
        : repoIds;

    const changed: QueueEntryRow[] = [];
    const perChallenge: Array<{
      challengeId: number;
      inserted: number;
      revived: number;
      alreadyQueued: number;
    }> = [];
    const outcomes = new Map<string, QueueGenerationOutcome | null>();
    for (const repoId of orderedRepoIds) {
      for (const challengeId of candidates.get(repoId) ?? []) {
        outcomes.set(
          `${challengeId}:${repoId}`,
          await enqueueQueueRepo(client, actorId, repoId, challengeId),
        );
      }
    }
    for (const challenge of challenges as Array<{ id: number }>) {
      const challengeId = Number(challenge.id);
      let inserted = 0;
      let revived = 0;
      let alreadyQueued = 0;
      for (const repoId of candidates.keys()) {
        if (!(candidates.get(repoId) ?? []).includes(challengeId)) continue;
        const outcome = outcomes.get(`${challengeId}:${repoId}`);
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

  for (const entry of result.changed) await broadcastEntry(entry, scopedMarker);
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
  let scopedMarker: boolean | null = null;
  const result = await withTransaction(async (client) => {
    const group = await client.query(`SELECT id FROM queue_groups WHERE id = $1 FOR UPDATE`, [
      queueGroupId,
    ]);
    if (group.rowCount === 0) {
      throw new NotFoundError("Queue group not found", { queueGroupId });
    }
    const fixtureMarker = await assertQueueGroupScope(client, actorId, queueGroupId);
    scopedMarker = fixtureMarker;
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
      `SELECT qe.* FROM queue_entries qe
        JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
        JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
        WHERE qe.challenge_id = ANY($1::int[]) AND qe.status IN ('waiting', 'called', 'in_room', 'presenting')
        ORDER BY qe.id FOR UPDATE`,
      [challengeIds, fixtureMarker],
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

  for (const entry of result) await broadcastEntry(entry, scopedMarker);
  return { cleared: result.length };
}
