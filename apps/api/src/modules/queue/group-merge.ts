import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Question } from "@hackos/shared/questions";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { challengePanels, mergeJudgingPanels } from "./criteria-merge.js";
import { anyEvaluationStarted } from "./evaluation-lock.js";
import { compactQueueGroupPositions } from "./ordering.js";

/**
 * Merging an enterprise's challenges into one shared judging queue, and
 * splitting them back apart (H46).
 *
 * This is the only thing in the product that can produce a `queue_groups` row
 * with more than one challenge — everything else (group-scoped ordering,
 * call-once dedupe, the expanded room set) was already built for N>1 and has
 * simply never seen one. The rules:
 *
 * - A group only ever holds challenges of its own enterprise. Enforced in the
 *   database (0410's `queue_group_enterprise_guard`); re-checked here so the
 *   caller gets a business error instead of a constraint violation.
 * - Merging is refused once any team involved has been **evaluated** — not
 *   merely once a queue exists or is being called from. Positions get
 *   renumbered into one key space and the judging form is replaced, neither
 *   of which is safe once an answer has been given, and both of which
 *   organisers legitimately do minutes before the first team walks in.
 * - Rooms follow their challenges: a room serving a group that is merged away
 *   is repointed at the target group rather than silently unassigned (the FK
 *   is `ON DELETE CASCADE`).
 */

export interface QueueGroupSummary {
  id: number;
  enterpriseId: number;
  enterpriseName: string;
  displayName: string;
  challenges: Array<{ id: number; title: string }>;
  rooms: Array<{ id: number; name: string }>;
  criteria: Question[] | null;
  /**
   * Teams queued for this queue, counted DISTINCT by repo across all its
   * challenges: a team that applied to two of a shared queue's challenges is
   * one team in it, exactly as it is one line item and one call.
   */
  teams: number;
  /** Merged criteria are only meaningful — and only editable — for N>1. */
  shared: boolean;
  /**
   * Whether any team in this queue has been evaluated. Merging, splitting and
   * editing the merged judging form are refused from that moment — and only
   * from that moment: a queue that exists, or is being called from, is still
   * configurable.
   */
  evaluationStarted: boolean;
}

const GROUP_SUMMARY_SQL = `
  SELECT qg.id, qg.enterprise_id, e.name AS enterprise_name,
         qg.display_name, qg.judging_panel_criteria,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) ORDER BY c.id)
                     FROM queue_group_challenges qgc
                     JOIN challenges c ON c.id = qgc.challenge_id
                    WHERE qgc.queue_group_id = qg.id), '[]'::jsonb) AS challenges,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rm.id, 'name', rm.name) ORDER BY rm.name)
                     FROM room_queue_groups rqg
                     JOIN rooms rm ON rm.id = rqg.room_id
                    WHERE rqg.queue_group_id = qg.id), '[]'::jsonb) AS rooms,
         (SELECT count(DISTINCT qe.repo_id)::int
            FROM queue_group_challenges qgc
            JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
           WHERE qgc.queue_group_id = qg.id
             AND qe.status NOT IN ('cancelled', 'disqualified')) AS teams,
         EXISTS (SELECT 1
                   FROM queue_group_challenges qgc
                   JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
                   LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
                  WHERE qgc.queue_group_id = qg.id
                    AND (qe.status = 'completed' OR ar.status = 'submitted')) AS evaluation_started
    FROM queue_groups qg
    JOIN enterprises e ON e.id = qg.enterprise_id`;

function toSummary(row: {
  id: number;
  enterprise_id: number;
  enterprise_name: string;
  display_name: string;
  judging_panel_criteria: unknown;
  challenges: Array<{ id: number; title: string }>;
  rooms: Array<{ id: number; name: string }>;
  teams: number;
  evaluation_started: boolean;
}): QueueGroupSummary {
  return {
    id: Number(row.id),
    enterpriseId: Number(row.enterprise_id),
    enterpriseName: row.enterprise_name,
    displayName: row.display_name,
    challenges: row.challenges ?? [],
    rooms: row.rooms ?? [],
    criteria: Array.isArray(row.judging_panel_criteria)
      ? (row.judging_panel_criteria as Question[])
      : null,
    teams: Number(row.teams ?? 0),
    shared: (row.challenges ?? []).length > 1,
    evaluationStarted: Boolean(row.evaluation_started),
  };
}

/** Every queue group of one enterprise — the merge screen's whole model. */
export async function listEnterpriseQueueGroups(
  enterpriseId: number,
): Promise<QueueGroupSummary[]> {
  const { rows } = await pool.query(
    `${GROUP_SUMMARY_SQL} WHERE qg.enterprise_id = $1 ORDER BY qg.display_name ASC, qg.id ASC`,
    [enterpriseId],
  );
  return rows.map(toSummary);
}

/**
 * Every queue the caller may manage, across enterprises — the "all queues"
 * admin surface. The scope IS the caller's authority: a global queue/sponsor
 * administrator sees every queue on the platform, a sponsor representative
 * sees only their own enterprises', and anyone else sees none.
 */
export async function listManageableQueueGroups(
  userId: number,
  isAdmin: boolean,
): Promise<QueueGroupSummary[]> {
  const { rows } = await pool.query(
    `${GROUP_SUMMARY_SQL}
      WHERE $1::boolean
         OR EXISTS (SELECT 1 FROM sponsors s
                     WHERE s.enterprise_id = qg.enterprise_id AND s.user_id = $2)
      ORDER BY e.name ASC, qg.display_name ASC, qg.id ASC`,
    [isAdmin, userId],
  );
  return rows.map(toSummary);
}

export async function getQueueGroup(queueGroupId: number): Promise<QueueGroupSummary> {
  const { rows } = await pool.query(`${GROUP_SUMMARY_SQL} WHERE qg.id = $1`, [queueGroupId]);
  if (!rows[0]) throw new NotFoundError("Queue group not found", { queueGroupId });
  return toSummary(rows[0]);
}

/**
 * Lock every queue group of one enterprise, lowest id first, for the whole
 * transaction. Merge and split both move `queue_group_challenges` rows
 * between an enterprise's groups and renumber positions across them, so two
 * concurrent calls on the same enterprise have to serialise; taking the locks
 * in id order means two calls touching overlapping groups can never deadlock.
 * `queue_entries` is deliberately NOT locked here — the merge is refused
 * outright while anything is out of the waiting state, so `call_next` cannot
 * be racing it for a row.
 */
async function lockEnterpriseGroups(client: Queryable, enterpriseId: number): Promise<void> {
  await client.query(
    `SELECT id FROM queue_groups WHERE enterprise_id = $1 ORDER BY id FOR UPDATE`,
    [enterpriseId],
  );
}

/** Challenge rows of `challengeIds`, refusing any that is not this enterprise's. */
async function assertEnterpriseChallenges(
  client: Queryable,
  enterpriseId: number,
  challengeIds: number[],
): Promise<Array<{ id: number; queue_group_id: number }>> {
  const { rows } = await client.query(
    `SELECT c.id, s.enterprise_id, qgc.queue_group_id
       FROM challenges c
       JOIN sponsors s ON s.id = c.author
       LEFT JOIN queue_group_challenges qgc ON qgc.challenge_id = c.id
      WHERE c.id = ANY($1::int[])`,
    [challengeIds],
  );
  const found = new Set(rows.map((row: { id: number }) => Number(row.id)));
  const missing = challengeIds.filter((id) => !found.has(id));
  if (missing.length) throw new NotFoundError("Challenge not found", { challengeIds: missing });

  const foreign = rows
    .filter((row: { enterprise_id: number }) => Number(row.enterprise_id) !== enterpriseId)
    .map((row: { id: number }) => Number(row.id));
  if (foreign.length) {
    // The same rule 0410's constraint trigger enforces, surfaced as a
    // business error rather than a 23514 from the database.
    throw new BadRequestError("A shared queue cannot span enterprises", {
      enterpriseId,
      challengeIds: foreign,
    });
  }
  return rows as Array<{ id: number; queue_group_id: number }>;
}

export interface MergeQueueGroupsInput {
  enterpriseId: number;
  challengeIds: number[];
  displayName: string;
  actorId: number;
  request?: { ip?: string; userAgent?: string };
}

/**
 * Merge `challengeIds` into one shared queue group named `displayName`.
 *
 * Idempotent by outcome: calling it again with the same challenges is a
 * no-op apart from the name, because they already share a group. The merged
 * judging form is computed here and stored straight away so judges never see
 * two forms for one group; the admin's review step edits it afterwards via
 * {@link updateQueueGroup}.
 */
export async function mergeQueueGroups(
  input: MergeQueueGroupsInput,
): Promise<QueueGroupSummary & { mergedPanel: { duplicatesDropped: number } }> {
  const { enterpriseId, challengeIds, displayName, actorId } = input;
  const unique = [...new Set(challengeIds)].sort((a, b) => a - b);
  const primary = unique[0];
  if (unique.length < 2 || primary === undefined) {
    throw new BadRequestError("A shared queue needs at least two challenges", { challengeIds });
  }

  const result = await withTransaction(async (client) => {
    await lockEnterpriseGroups(client, enterpriseId);
    const challenges = await assertEnterpriseChallenges(client, enterpriseId, unique);
    if (await anyEvaluationStarted(client, unique)) {
      throw new ConflictError("Cannot merge queues once a team has been evaluated", {
        challengeIds,
      });
    }

    // Target = the group of the lowest challenge id. Arbitrary but stable, so
    // a retried merge lands on the same group instead of ping-ponging.
    const targetGroupId = Number(
      challenges.find((row) => Number(row.id) === primary)?.queue_group_id,
    );
    if (!Number.isFinite(targetGroupId)) {
      throw new NotFoundError("Challenge has no queue group", { challengeId: primary });
    }

    const sourceGroupIds = [
      ...new Set(
        challenges
          .map((row) => Number(row.queue_group_id))
          .filter((id) => Number.isFinite(id) && id !== targetGroupId),
      ),
    ];

    const before = (await client.query(`${GROUP_SUMMARY_SQL} WHERE qg.id = $1`, [targetGroupId]))
      .rows[0];

    await client.query(
      `UPDATE queue_group_challenges SET queue_group_id = $1 WHERE challenge_id = ANY($2::int[])`,
      [targetGroupId, unique],
    );

    // Rooms follow their challenges. A room already serving the target keeps
    // it (UNIQUE(room_id) — the DO NOTHING branch), and a source group that
    // still has other rooms hands them all over: after this the source groups
    // are empty and get dropped, and the FK is ON DELETE CASCADE, so skipping
    // this would quietly unassign those rooms.
    if (sourceGroupIds.length) {
      await client.query(
        `UPDATE room_queue_groups SET queue_group_id = $1, assigned_at = now()
          WHERE queue_group_id = ANY($2::int[])
            AND room_id NOT IN (SELECT room_id FROM room_queue_groups WHERE queue_group_id = $1)`,
        [targetGroupId, sourceGroupIds],
      );
      // Anything left pointing at a source group is a room that already serves
      // the target; drop the stale row before the group goes.
      await client.query(`DELETE FROM room_queue_groups WHERE queue_group_id = ANY($1::int[])`, [
        sourceGroupIds,
      ]);
      // Only groups that the merge actually emptied — a source group holding
      // challenges the admin did not select stays exactly as it is.
      await client.query(
        `DELETE FROM queue_groups qg
          WHERE qg.id = ANY($1::int[])
            AND NOT EXISTS (SELECT 1 FROM queue_group_challenges qgc
                             WHERE qgc.queue_group_id = qg.id)`,
        [sourceGroupIds],
      );
    }

    // One shared queue is one ordering key space: until now each challenge
    // numbered its own positions from 1, so merged rows collide. Renumber the
    // whole group into a contiguous run before anything reads it.
    await compactQueueGroupPositions(client, primary);

    const merged = mergeJudgingPanels(await challengePanels(client, unique));
    await client.query(
      `UPDATE queue_groups
          SET display_name = $1, judging_panel_criteria = $2::jsonb
        WHERE id = $3`,
      [displayName, JSON.stringify(merged.questions), targetGroupId],
    );

    const after = (await client.query(`${GROUP_SUMMARY_SQL} WHERE qg.id = $1`, [targetGroupId]))
      .rows[0];

    await audit(client, {
      actorId,
      entityType: "queue_group",
      entityId: targetGroupId,
      action: "queue_group.merge",
      before,
      after: { ...after, mergedFromGroupIds: sourceGroupIds },
      ip: input.request?.ip,
      userAgent: input.request?.userAgent,
    });

    return { summary: toSummary(after), duplicatesDropped: merged.duplicatesDropped };
  });

  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ROOM_CHANGED, { queueGroupId: result.summary.id });
  return { ...result.summary, mergedPanel: { duplicatesDropped: result.duplicatesDropped } };
}

/**
 * Give each of `challengeIds` its own 1:1 group again — the "one queue per
 * challenge" side of the toggle. The challenge left holding the original
 * group keeps it, so splitting a two-challenge group produces two 1:1 groups
 * rather than three groups and an orphan.
 */
export async function splitQueueGroup(input: {
  enterpriseId: number;
  queueGroupId: number;
  actorId: number;
  request?: { ip?: string; userAgent?: string };
}): Promise<QueueGroupSummary[]> {
  const { enterpriseId, queueGroupId, actorId } = input;

  const groups = await withTransaction(async (client) => {
    await lockEnterpriseGroups(client, enterpriseId);
    const before = (await client.query(`${GROUP_SUMMARY_SQL} WHERE qg.id = $1`, [queueGroupId]))
      .rows[0];
    if (!before) throw new NotFoundError("Queue group not found", { queueGroupId });
    if (Number(before.enterprise_id) !== enterpriseId) {
      throw new NotFoundError("Queue group not found", { queueGroupId });
    }
    const memberIds = (before.challenges as Array<{ id: number }>).map((c) => Number(c.id));
    if (memberIds.length < 2) {
      throw new BadRequestError("Queue group is not shared", { queueGroupId });
    }
    if (await anyEvaluationStarted(client, memberIds)) {
      throw new ConflictError("Cannot split a queue once a team has been evaluated", {
        queueGroupId,
      });
    }

    // The lowest challenge id keeps the existing group; the rest each get a
    // fresh 1:1 group named after their own title, matching what 0410's
    // per-challenge trigger would have created.
    const [kept, ...moved] = memberIds;
    if (kept === undefined) throw new BadRequestError("Queue group is empty", { queueGroupId });
    for (const challengeId of moved) {
      const { rows } = await client.query(
        `INSERT INTO queue_groups (enterprise_id, display_name, created_by)
         SELECT $1, c.title, $2 FROM challenges c WHERE c.id = $3
         RETURNING id`,
        [enterpriseId, actorId, challengeId],
      );
      await client.query(
        `UPDATE queue_group_challenges SET queue_group_id = $1 WHERE challenge_id = $2`,
        [Number(rows[0].id), challengeId],
      );
      // Each queue is its own key space again.
      await compactQueueGroupPositions(client, challengeId);
    }
    // The kept group is 1:1 again: its name follows its challenge's title and
    // a merged judging form no longer means anything.
    await client.query(
      `UPDATE queue_groups qg
          SET display_name = c.title, judging_panel_criteria = NULL
         FROM challenges c
        WHERE c.id = $1 AND qg.id = $2`,
      [kept, queueGroupId],
    );
    await compactQueueGroupPositions(client, kept);

    await audit(client, {
      actorId,
      entityType: "queue_group",
      entityId: queueGroupId,
      action: "queue_group.split",
      before,
      after: { challengeIds: memberIds },
      ip: input.request?.ip,
      userAgent: input.request?.userAgent,
    });

    const { rows: after } = await client.query(
      `${GROUP_SUMMARY_SQL}
        WHERE qg.id IN (SELECT queue_group_id FROM queue_group_challenges
                         WHERE challenge_id = ANY($1::int[]))
        ORDER BY qg.display_name ASC, qg.id ASC`,
      [memberIds],
    );
    return after.map(toSummary);
  });

  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ROOM_CHANGED, { queueGroupId });
  return groups;
}

/**
 * The admin's review/edit of a merged group: its name and its judging form.
 * Only a shared group has a form of its own — a 1:1 group's form is its
 * challenge's, and its name follows that challenge's title.
 */
export async function updateQueueGroup(input: {
  queueGroupId: number;
  displayName?: string;
  criteria?: Question[];
  actorId: number;
  request?: { ip?: string; userAgent?: string };
}): Promise<QueueGroupSummary> {
  const { queueGroupId, displayName, criteria, actorId } = input;

  const summary = await withTransaction(async (client) => {
    const before = (
      await client.query(`${GROUP_SUMMARY_SQL} WHERE qg.id = $1 FOR UPDATE OF qg`, [queueGroupId])
    ).rows[0];
    if (!before) throw new NotFoundError("Queue group not found", { queueGroupId });
    const shared = (before.challenges as unknown[]).length > 1;
    if (!shared) {
      throw new BadRequestError("Queue group is not shared", { queueGroupId });
    }
    // The name is safe to change at any time; the questions are not, once
    // somebody has answered them.
    if (criteria !== undefined && before.evaluation_started) {
      throw new ConflictError("Judging form is locked: a team has already been evaluated", {
        queueGroupId,
        code: "panel_locked",
      });
    }

    await client.query(
      `UPDATE queue_groups
          SET display_name = COALESCE($1, display_name),
              judging_panel_criteria = COALESCE($2::jsonb, judging_panel_criteria)
        WHERE id = $3`,
      [displayName ?? null, criteria ? JSON.stringify(criteria) : null, queueGroupId],
    );

    const after = (await client.query(`${GROUP_SUMMARY_SQL} WHERE qg.id = $1`, [queueGroupId]))
      .rows[0];
    await audit(client, {
      actorId,
      entityType: "queue_group",
      entityId: queueGroupId,
      action: "queue_group.update",
      before,
      after,
      ip: input.request?.ip,
      userAgent: input.request?.userAgent,
    });
    return toSummary(after);
  });

  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ROOM_CHANGED, { queueGroupId });
  return summary;
}

/**
 * Set exactly which rooms serve a queue, in one call.
 *
 * The room -> queue link is `UNIQUE(room_id)`: a room serves one queue at a
 * time. So this claims the named rooms for this queue (taking any of them
 * away from another queue of the SAME enterprise) and releases the ones it no
 * longer holds. Rooms belonging to another enterprise's queue are refused —
 * moving a room between enterprises stays an admin action on the rooms
 * screen, because it is a decision about the venue, not about a queue.
 *
 * This is what lets a sponsor route their own queues without touching the
 * rooms admin: an enterprise with two rooms assigned to it can put both, one,
 * or neither behind a given queue.
 */
export async function setQueueGroupRooms(input: {
  queueGroupId: number;
  roomIds: number[];
  actorId: number;
  request?: { ip?: string; userAgent?: string };
}): Promise<QueueGroupSummary> {
  const { queueGroupId, actorId } = input;
  const roomIds = [...new Set(input.roomIds)];

  const summary = await withTransaction(async (client) => {
    const before = (await client.query(`${GROUP_SUMMARY_SQL} WHERE qg.id = $1`, [queueGroupId]))
      .rows[0];
    if (!before) throw new NotFoundError("Queue group not found", { queueGroupId });
    const enterpriseId = Number(before.enterprise_id);

    if (roomIds.length) {
      // Lock the rooms in id order so two enterprises claiming the same room
      // serialise rather than deadlock.
      await client.query(`SELECT id FROM rooms WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [
        roomIds,
      ]);
      const { rows: found } = await client.query(`SELECT id FROM rooms WHERE id = ANY($1::int[])`, [
        roomIds,
      ]);
      if (found.length !== roomIds.length) {
        const known = new Set(found.map((row: { id: number }) => Number(row.id)));
        throw new NotFoundError("Room not found", {
          roomIds: roomIds.filter((id) => !known.has(id)),
        });
      }
      const { rows: foreign } = await client.query(
        `SELECT rqg.room_id
           FROM room_queue_groups rqg
           JOIN queue_groups qg ON qg.id = rqg.queue_group_id
          WHERE rqg.room_id = ANY($1::int[])
            AND qg.enterprise_id <> $2`,
        [roomIds, enterpriseId],
      );
      if (foreign.length) {
        throw new ConflictError("Room serves another enterprise", {
          roomIds: foreign.map((row: { room_id: number }) => Number(row.room_id)),
        });
      }
    }

    await client.query(
      `DELETE FROM room_queue_groups
        WHERE queue_group_id = $1 AND NOT (room_id = ANY($2::int[]))`,
      [queueGroupId, roomIds],
    );
    if (roomIds.length) {
      await client.query(
        `INSERT INTO room_queue_groups (room_id, queue_group_id, assigned_by)
         SELECT unnest($2::int[]), $1, $3
         ON CONFLICT (room_id) DO UPDATE
           SET queue_group_id = EXCLUDED.queue_group_id,
               assigned_by = EXCLUDED.assigned_by,
               assigned_at = now()`,
        [queueGroupId, roomIds, actorId],
      );
    }

    const after = (await client.query(`${GROUP_SUMMARY_SQL} WHERE qg.id = $1`, [queueGroupId]))
      .rows[0];
    await audit(client, {
      actorId,
      entityType: "queue_group",
      entityId: queueGroupId,
      action: "queue_group.set_rooms",
      before: { rooms: before.rooms },
      after: { rooms: after.rooms },
      ip: input.request?.ip,
      userAgent: input.request?.userAgent,
    });
    return toSummary(after);
  });

  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ROOM_CHANGED, { queueGroupId });
  return summary;
}

/** Every room this enterprise may route a queue to: its own, plus unassigned. */
export async function assignableRooms(
  enterpriseId: number,
): Promise<Array<{ id: number; name: string; queueGroupId: number | null }>> {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, rqg.queue_group_id
       FROM rooms r
       LEFT JOIN room_queue_groups rqg ON rqg.room_id = r.id
       LEFT JOIN queue_groups qg ON qg.id = rqg.queue_group_id
      WHERE rqg.room_id IS NULL OR qg.enterprise_id = $1
      ORDER BY r.name ASC`,
    [enterpriseId],
  );
  return rows.map((row: { id: number; name: string; queue_group_id: number | null }) => ({
    id: Number(row.id),
    name: row.name,
    queueGroupId: row.queue_group_id === null ? null : Number(row.queue_group_id),
  }));
}

/** Preview of what merging `challengeIds` would produce, without writing. */
export async function previewMergedPanel(challengeIds: number[]) {
  const merged = mergeJudgingPanels(await challengePanels(pool, challengeIds));
  return {
    questions: merged.questions,
    duplicatesDropped: merged.duplicatesDropped,
    renamedKeys: merged.renamedKeys,
  };
}
