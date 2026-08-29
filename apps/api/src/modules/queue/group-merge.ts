import { EVENTS } from "@hackos/shared/events";
import type { Question } from "@hackos/shared/questions";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { isSyntheticOperator } from "../logistics/review-fixture-scope.js";
import { broadcastQueueEvent } from "./broadcast.js";
import { challengePanels, mergeJudgingPanels } from "./criteria-merge.js";
import {
  anyEvaluationStarted,
  lockEvaluationEntriesForChallenges,
  lockEvaluationEntriesForGroup,
} from "./evaluation-lock.js";
import { notifyQueueTopologyChanged } from "./notify.js";
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
 * - Rooms follow their challenges only when a source group is emptied. A room
 *   serving a source group that still has unselected challenges stays there;
 *   rooms from an emptied group are repointed at the target rather than
 *   silently unassigned (the FK is `ON DELETE CASCADE`).
 */

export interface QueueGroupSummary {
  id: number;
  enterpriseId: number;
  enterpriseName: string;
  enterpriseLogoUrl: string | null;
  enterpriseLogoNegativeUrl: string | null;
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
         e.logo_url AS enterprise_logo_url,
         COALESCE(e.logo_negative_url, e.logo_url) AS enterprise_logo_negative_url,
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
            JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = false
           WHERE qgc.queue_group_id = qg.id
             AND qe.status NOT IN ('cancelled', 'disqualified')) AS teams,
         EXISTS (SELECT 1
                   FROM queue_group_challenges qgc
                   JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
                   JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = false
                   LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
                  WHERE qgc.queue_group_id = qg.id
                    AND (qe.status = 'completed' OR ar.status = 'submitted')) AS evaluation_started
    FROM queue_groups qg
    JOIN enterprises e ON e.id = qg.enterprise_id
   WHERE NOT EXISTS (
     SELECT 1
       FROM queue_group_challenges hidden_qgc
       JOIN challenges hidden_c ON hidden_c.id = hidden_qgc.challenge_id
      WHERE hidden_qgc.queue_group_id = qg.id
        AND hidden_c.is_test_account = true
   )`;

type QueueTopologySnapshot = {
  queueGroupIds: number[];
  challengeIds: number[];
};
type QueueTopologyPair = [QueueTopologySnapshot, QueueTopologySnapshot];

/** Capture both sides of a queue-group graph while its mutation is open. */
async function captureQueueTopology(
  client: Queryable,
  queueGroupIds: readonly number[],
): Promise<QueueTopologySnapshot> {
  const normalizedGroupIds = [...new Set(queueGroupIds)].filter(Number.isFinite);
  if (normalizedGroupIds.length === 0) {
    return { queueGroupIds: [], challengeIds: [] };
  }
  const { rows } = await client.query<{ queue_group_id: number; challenge_id: number }>(
    `SELECT queue_group_id, challenge_id
       FROM queue_group_challenges
      WHERE queue_group_id = ANY($1::int[])`,
    [normalizedGroupIds],
  );
  return {
    // Preserve ids whose memberships are about to disappear. The post-commit
    // notifier can then re-resolve their snapshot challenges to their current
    // group instead of losing a participant refresh on a stale id.
    queueGroupIds: normalizedGroupIds,
    challengeIds: [...new Set(rows.map((row) => Number(row.challenge_id)))],
  };
}

async function broadcastQueueTopology(topology: QueueTopologySnapshot[]): Promise<void> {
  const queueGroupIds = [...new Set(topology.flatMap((snapshot) => snapshot.queueGroupIds))].filter(
    Number.isFinite,
  );
  await Promise.all(
    queueGroupIds.map((queueGroupId) =>
      broadcastQueueEvent(pool, "queueGroup", queueGroupId, EVENTS.QUEUE_ROOM_CHANGED, {
        queueGroupId,
      }),
    ),
  );
}

function toSummary(row: {
  id: number;
  enterprise_id: number;
  enterprise_name: string;
  enterprise_logo_url: string | null;
  enterprise_logo_negative_url: string | null;
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
    enterpriseLogoUrl: row.enterprise_logo_url,
    enterpriseLogoNegativeUrl: row.enterprise_logo_negative_url,
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
    `${GROUP_SUMMARY_SQL} AND qg.enterprise_id = $1 ORDER BY qg.display_name ASC, qg.id ASC`,
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
  // The management summary is intentionally the real-event projection (its
  // counts and hidden-group predicate are not marker-parameterized). A future
  // synthetic queue-admin must not receive that projection by guessing this
  // endpoint, so fail closed until a dedicated marker-scoped summary exists.
  if (await isSyntheticOperator(pool, userId)) return [];
  const { rows } = await pool.query(
    `${GROUP_SUMMARY_SQL}
      AND ($1::boolean
         OR EXISTS (SELECT 1 FROM sponsors s
                     WHERE s.enterprise_id = qg.enterprise_id AND s.user_id = $2)
      )
      ORDER BY e.name ASC, qg.display_name ASC, qg.id ASC`,
    [isAdmin, userId],
  );
  return rows.map(toSummary);
}

export async function getQueueGroup(queueGroupId: number): Promise<QueueGroupSummary> {
  const { rows } = await pool.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [queueGroupId]);
  if (!rows[0]) throw new NotFoundError("Queue group not found", { queueGroupId });
  return toSummary(rows[0]);
}

/**
 * Lock every queue group of one enterprise, lowest id first, for the whole
 * transaction. Merge and split both move `queue_group_challenges` rows
 * between an enterprise's groups and renumber positions across them, so two
 * concurrent calls on the same enterprise have to serialise; taking the locks
 * in id order means two calls touching overlapping groups can never deadlock.
 * Evaluation-sensitive operations then lock queue entries in id order before
 * checking whether the first evaluation exists. Review submission takes the
 * same group-then-entry order, so neither side can act on a stale check.
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
      WHERE c.id = ANY($1::int[])
        AND c.is_test_account = false
      FOR SHARE OF c, s`,
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
    await lockEvaluationEntriesForChallenges(client, unique);
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
    const beforeTopology = await captureQueueTopology(client, [targetGroupId, ...sourceGroupIds]);

    const before = (await client.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [targetGroupId]))
      .rows[0];

    await client.query(
      `UPDATE queue_group_challenges SET queue_group_id = $1 WHERE challenge_id = ANY($2::int[])`,
      [targetGroupId, unique],
    );

    // A source group can contain challenges that were not selected for this
    // merge. Keep its rooms with that surviving queue; only move rooms from a
    // source group that is empty after the selected challenge links move.
    if (sourceGroupIds.length) {
      const { rows: emptiedSourceRows } = await client.query<{ id: number }>(
        `SELECT id
           FROM queue_groups qg
          WHERE qg.id = ANY($1::int[])
            AND NOT EXISTS (
              SELECT 1 FROM queue_group_challenges qgc
               WHERE qgc.queue_group_id = qg.id
            )
          ORDER BY id
          FOR UPDATE`,
        [sourceGroupIds],
      );
      const emptiedSourceGroupIds = emptiedSourceRows.map((row) => Number(row.id));
      if (emptiedSourceGroupIds.length) {
        await client.query(
          `UPDATE room_queue_groups SET queue_group_id = $1, assigned_at = now()
          WHERE queue_group_id = ANY($2::int[])
            AND room_id NOT IN (SELECT room_id FROM room_queue_groups WHERE queue_group_id = $1)`,
          [targetGroupId, emptiedSourceGroupIds],
        );
        // Anything left pointing at an emptied source group already serves the
        // target; drop the stale duplicate before removing that source group.
        await client.query(`DELETE FROM room_queue_groups WHERE queue_group_id = ANY($1::int[])`, [
          emptiedSourceGroupIds,
        ]);
      }
      await client.query(
        `DELETE FROM queue_groups qg
          WHERE qg.id = ANY($1::int[])
            AND NOT EXISTS (SELECT 1 FROM queue_group_challenges qgc
                             WHERE qgc.queue_group_id = qg.id)`,
        [emptiedSourceGroupIds],
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

    const afterTopology = await captureQueueTopology(client, [targetGroupId, ...sourceGroupIds]);

    const after = (await client.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [targetGroupId]))
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

    return {
      summary: toSummary(after),
      duplicatesDropped: merged.duplicatesDropped,
      topology: [beforeTopology, afterTopology] as QueueTopologyPair,
    };
  });

  await broadcastQueueTopology(result.topology);
  await notifyQueueTopologyChanged(pool, {
    oldQueueGroupIds: result.topology[0].queueGroupIds,
    newQueueGroupIds: result.topology[1].queueGroupIds,
    oldChallengeIds: result.topology[0].challengeIds,
    newChallengeIds: result.topology[1].challengeIds,
  });
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

  const result = await withTransaction(async (client) => {
    await lockEnterpriseGroups(client, enterpriseId);
    const before = (await client.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [queueGroupId]))
      .rows[0];
    if (!before) throw new NotFoundError("Queue group not found", { queueGroupId });
    if (Number(before.enterprise_id) !== enterpriseId) {
      throw new NotFoundError("Queue group not found", { queueGroupId });
    }
    const memberIds = (before.challenges as Array<{ id: number }>).map((c) => Number(c.id));
    if (memberIds.length < 2) {
      throw new BadRequestError("Queue group is not shared", { queueGroupId });
    }
    await lockEvaluationEntriesForChallenges(client, memberIds);
    if (await anyEvaluationStarted(client, memberIds)) {
      throw new ConflictError("Cannot split a queue once a team has been evaluated", {
        queueGroupId,
      });
    }
    const beforeTopology = await captureQueueTopology(client, [queueGroupId]);

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
        AND qg.id IN (SELECT queue_group_id FROM queue_group_challenges
                         WHERE challenge_id = ANY($1::int[]))
        ORDER BY qg.display_name ASC, qg.id ASC`,
      [memberIds],
    );
    const afterTopology = await captureQueueTopology(client, [
      queueGroupId,
      ...after.map((row) => Number(row.id)),
    ]);
    return {
      groups: after.map(toSummary),
      topology: [beforeTopology, afterTopology] as QueueTopologyPair,
    };
  });

  await broadcastQueueTopology(result.topology);
  await notifyQueueTopologyChanged(pool, {
    oldQueueGroupIds: result.topology[0].queueGroupIds,
    newQueueGroupIds: result.topology[1].queueGroupIds,
    oldChallengeIds: result.topology[0].challengeIds,
    newChallengeIds: result.topology[1].challengeIds,
  });
  return result.groups;
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

  const result = await withTransaction(async (client) => {
    const locked = await client.query(`SELECT id FROM queue_groups WHERE id = $1 FOR UPDATE`, [
      queueGroupId,
    ]);
    if (!locked.rowCount) throw new NotFoundError("Queue group not found", { queueGroupId });
    if (criteria !== undefined) await lockEvaluationEntriesForGroup(client, queueGroupId);

    const before = (await client.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [queueGroupId]))
      .rows[0];
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
    const beforeTopology = await captureQueueTopology(client, [queueGroupId]);

    await client.query(
      `UPDATE queue_groups
          SET display_name = COALESCE($1, display_name),
              judging_panel_criteria = COALESCE($2::jsonb, judging_panel_criteria)
        WHERE id = $3`,
      [displayName ?? null, criteria ? JSON.stringify(criteria) : null, queueGroupId],
    );

    const after = (await client.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [queueGroupId]))
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
    const afterTopology = await captureQueueTopology(client, [queueGroupId]);
    return {
      summary: toSummary(after),
      topology: [beforeTopology, afterTopology] as QueueTopologyPair,
    };
  });

  await broadcastQueueTopology(result.topology);
  await notifyQueueTopologyChanged(pool, {
    oldQueueGroupIds: result.topology[0].queueGroupIds,
    newQueueGroupIds: result.topology[1].queueGroupIds,
    oldChallengeIds: result.topology[0].challengeIds,
    newChallengeIds: result.topology[1].challengeIds,
  });
  return result.summary;
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

  const result = await withTransaction(async (client) => {
    const initial = (await client.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [queueGroupId]))
      .rows[0];
    if (!initial) throw new NotFoundError("Queue group not found", { queueGroupId });

    // Lock all groups currently serving the named rooms before changing the
    // unique room links. This keeps the old group snapshot stable and follows
    // the same group-before-room lock order as merge/split operations.
    const { rows: servingBefore } = await client.query<{
      room_id: number;
      queue_group_id: number;
    }>(
      `SELECT rqg.room_id, rqg.queue_group_id
         FROM room_queue_groups rqg
        WHERE rqg.room_id = ANY($1::int[])
        ORDER BY rqg.queue_group_id, rqg.room_id`,
      [roomIds],
    );
    const affectedGroupIds = [
      ...new Set([queueGroupId, ...servingBefore.map((row) => Number(row.queue_group_id))]),
    ]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    await client.query(
      `SELECT id
         FROM queue_groups
        WHERE id = ANY($1::int[])
        ORDER BY id
        FOR UPDATE`,
      [affectedGroupIds],
    );
    const before = (await client.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [queueGroupId]))
      .rows[0];
    if (!before) throw new NotFoundError("Queue group not found", { queueGroupId });
    const enterpriseId = Number(before.enterprise_id);

    // H38/H46: include every room currently serving the target group, not only rooms
    // named in this replacement. In particular, an empty `roomIds` means
    // "clear the queue": those existing links still need the room lock before
    // the topology snapshot, otherwise a concurrent replacement can commit
    // while this transaction waits on the room lock and its old group would
    // be absent from the invalidation boundary.
    const { rows: targetServingBefore } = await client.query<{ room_id: number }>(
      `SELECT room_id
         FROM room_queue_groups
        WHERE queue_group_id = $1
        ORDER BY room_id`,
      [queueGroupId],
    );

    // Lock the rooms in id order so two enterprises claiming the same room
    // serialise rather than deadlock. When clearing every room, lock the
    // group's current links too; otherwise a concurrent replacement can
    // commit while we wait and its former group would be absent from the
    // invalidation snapshot.
    const roomIdsToLock = [
      ...new Set([
        ...roomIds,
        ...servingBefore
          .filter((row) => Number(row.queue_group_id) === queueGroupId)
          .map((row) => Number(row.room_id)),
        ...targetServingBefore.map((row) => Number(row.room_id)),
      ]),
    ].sort((a, b) => a - b);
    if (roomIdsToLock.length) {
      await client.query(`SELECT id FROM rooms WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [
        roomIdsToLock,
      ]);
    }
    // The room lock is the point at which serving links stop changing. Re-read
    // them before the mutation so a group that replaced the pre-lock snapshot
    // is still included in the old-side topology invalidation.
    const { rows: servingAtLock } = await client.query<{
      room_id: number;
      queue_group_id: number;
    }>(
      `SELECT rqg.room_id, rqg.queue_group_id
         FROM room_queue_groups rqg
        WHERE rqg.room_id = ANY($1::int[])
        ORDER BY rqg.queue_group_id, rqg.room_id`,
      [roomIdsToLock],
    );
    const topologyGroupIds = [
      ...new Set([...affectedGroupIds, ...servingAtLock.map((row) => Number(row.queue_group_id))]),
    ]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const beforeTopology = await captureQueueTopology(client, topologyGroupIds);

    if (roomIds.length) {
      const { rows: found } = await client.query(`SELECT id FROM rooms WHERE id = ANY($1::int[])`, [
        roomIds,
      ]);
      if (found.length !== roomIds.length) {
        const known = new Set(found.map((row: { id: number }) => Number(row.id)));
        throw new NotFoundError("Room not found", {
          roomIds: roomIds.filter((id) => !known.has(id)),
        });
      }
      // A queue may only be served by rooms already in this enterprise's
      // pool (room_enterprises) — never a room pooled elsewhere, and never
      // one with no pool at all (an admin has to give it to the enterprise
      // first, from the Rooms admin page).
      const { rows: outsidePool } = await client.query(
        `SELECT r.id AS room_id
           FROM rooms r
           LEFT JOIN room_enterprises re ON re.room_id = r.id
          WHERE r.id = ANY($1::int[])
            AND re.enterprise_id IS DISTINCT FROM $2`,
        [roomIds, enterpriseId],
      );
      if (outsidePool.length) {
        throw new ConflictError("Room is not in this enterprise's room pool", {
          roomIds: outsidePool.map((row: { room_id: number }) => Number(row.room_id)),
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

    const after = (await client.query(`${GROUP_SUMMARY_SQL} AND qg.id = $1`, [queueGroupId]))
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
    const afterTopology = await captureQueueTopology(client, topologyGroupIds);
    return {
      summary: toSummary(after),
      topology: [beforeTopology, afterTopology] as QueueTopologyPair,
    };
  });

  await broadcastQueueTopology(result.topology);
  await notifyQueueTopologyChanged(pool, {
    oldQueueGroupIds: result.topology[0].queueGroupIds,
    newQueueGroupIds: result.topology[1].queueGroupIds,
    oldChallengeIds: result.topology[0].challengeIds,
    newChallengeIds: result.topology[1].challengeIds,
  });
  return result.summary;
}

/**
 * Every room this enterprise may route a queue to: its room pool
 * (room_enterprises), not "unassigned rooms" — a room has to be given to the
 * enterprise from the Rooms admin page before any of its queues can use it.
 */
export async function assignableRooms(
  enterpriseId: number,
): Promise<Array<{ id: number; name: string; queueGroupId: number | null }>> {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, rqg.queue_group_id
       FROM rooms r
       JOIN room_enterprises re ON re.room_id = r.id AND re.enterprise_id = $1
       LEFT JOIN room_queue_groups rqg ON rqg.room_id = r.id
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
export async function previewMergedPanel(enterpriseId: number, challengeIds: number[]) {
  return withTransaction(async (client) => {
    await assertEnterpriseChallenges(client, enterpriseId, challengeIds);
    const merged = mergeJudgingPanels(await challengePanels(client, challengeIds));
    return {
      questions: merged.questions,
      duplicatesDropped: merged.duplicatesDropped,
      renamedKeys: merged.renamedKeys,
    };
  });
}
