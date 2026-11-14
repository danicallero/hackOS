import type { Queryable } from "../../db/pool.js";
import { withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";

/**
 * The destructive reset keeps event identity and challenge definitions, but
 * removes every project, queue, and judging artifact so the event can
 * start the Q flow again (H16-H40, H53).
 */
export interface JudgingDataResetResult {
  ok: true;
  counts: {
    projects: number;
    projectMembers: number;
    queueEntries: number;
    queueHistory: number;
    reviews: number;
    reviewVersions: number;
    judgingSessions: number;
    winners: number;
    judgeAssignments: number;
    queueGroupsRemoved: number;
    queueGroupsRecreated: number;
    queueGroupMembers: number;
    roomQueueAssignments: number;
    roomEnterpriseAssignments: number;
    queueNotifications: number;
    projectNotifications: number;
    queuePreferences: number;
    queueIdempotencyKeys: number;
  };
}

interface IdempotencyExclusion {
  key: string | null;
  scope: string | null;
}

const NO_IDEMPOTENCY_EXCLUSION: Readonly<IdempotencyExclusion> = Object.freeze({
  key: null,
  scope: null,
});

const Q_IDEMPOTENCY_SCOPE = `(
  scope LIKE '% /api/queue%'
  OR scope LIKE '% /api/repos%'
  OR scope LIKE '% /api/projects%'
  OR scope LIKE '% /api/me/projects%'
  OR scope LIKE '% /api/enterprises/%/queue-groups%'
)`;

/**
 * Multi-edition: the reset only touches the scoped edition's rows (a closed
 * edition is read-only history and other editions are untouched). Tables
 * without their own event_key are reached through their parent.
 */
const IN_EDITION = {
  repos: `event_key = current_edition()`,
  submissions: `repo_id IN (SELECT id FROM repos WHERE event_key = current_edition())`,
  queue_entries: `event_key = current_edition()`,
  entryChildren: `queue_entry_id IN (SELECT id FROM queue_entries WHERE event_key = current_edition())`,
  attemptChildren: `attempt_id IN (SELECT id FROM queue_entries WHERE event_key = current_edition())`,
  challenge_winners: `challenge_id IN (SELECT id FROM challenges WHERE event_key = current_edition())`,
  enterprise_judges: `enterprise_id IN (SELECT id FROM enterprises WHERE event_key = current_edition())`,
  queue_groups: `event_key = current_edition()`,
  groupChildren: `queue_group_id IN (SELECT id FROM queue_groups WHERE event_key = current_edition())`,
  roomChildren: `room_id IN (SELECT id FROM rooms WHERE event_key = current_edition())`,
  rooms: `event_key = current_edition()`,
} as const;

async function countWhere(
  client: Queryable,
  table: string,
  where: string,
  params: unknown[] = [],
): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE ${where}`,
    params,
  );
  return Number(rows[0]?.count ?? 0);
}

async function recreateDefaultQueueGroups(client: Queryable): Promise<number> {
  const { rows: challenges } = await client.query(
    `SELECT c.id, c.title, s.enterprise_id
       FROM challenges c
       JOIN sponsors s ON s.id = c.author
      WHERE c.event_key = current_edition()
      ORDER BY c.id
      FOR UPDATE OF c`,
  );

  for (const challenge of challenges as Array<{
    id: number;
    title: string;
    enterprise_id: number;
  }>) {
    const { rows: groups } = await client.query(
      `INSERT INTO queue_groups (enterprise_id, display_name)
       VALUES ($1, $2)
       RETURNING id`,
      [challenge.enterprise_id, challenge.title],
    );
    await client.query(
      `INSERT INTO queue_group_challenges (queue_group_id, challenge_id)
       VALUES ($1, $2)`,
      [groups[0].id, challenge.id],
    );
  }

  return challenges.length;
}

/**
 * Atomically returns the event to a pre-import, pre-queue state. The table
 * locks serialize this reset against in-flight Q/project writes; the audit
 * row is intentionally retained as the one durable record of the reset.
 */
export async function resetJudgingData(
  actorId: number,
  idempotency: IdempotencyExclusion = NO_IDEMPOTENCY_EXCLUSION,
): Promise<JudgingDataResetResult> {
  return withTransaction(async (client) => {
    // This is an explicitly confirmed maintenance operation, not a normal
    // request-sized mutation. Disable the pool's default statement timeout
    // before taking the table locks so a large delete or a short wait for an
    // in-flight Q transaction cannot abort the all-or-nothing reset. The
    // transaction still rolls back completely if the database reports an
    // error.
    await client.query(`SET LOCAL statement_timeout = 0`);

    // Lock in a stable alphabetical order so two destructive requests cannot
    // deadlock. These are the Q/project tables touched by H16-H40.
    await client.query(`
      LOCK TABLE
        attempt_review,
        attempt_review_versions,
        challenge_winners,
        challenges,
        enterprise_judges,
        idempotency_keys,
        judging_session,
        notification_outbox,
        notification_preferences,
        queue_entries,
        queue_group_challenges,
        queue_groups,
        queue_history,
        queue_settings,
        repos,
        room_enterprises,
        room_queue_groups,
        room_queue_state,
        rooms,
        submissions
      IN ACCESS EXCLUSIVE MODE
    `);

    const idempotencyParams = [idempotency.key, idempotency.scope];
    const qIdempotencyWhere = `${Q_IDEMPOTENCY_SCOPE}
      AND ($1::text IS NULL OR key <> $1 OR scope <> $2)`;

    const counts: JudgingDataResetResult["counts"] = {
      projects: await countWhere(client, "repos", IN_EDITION.repos),
      projectMembers: await countWhere(client, "submissions", IN_EDITION.submissions),
      queueEntries: await countWhere(client, "queue_entries", IN_EDITION.queue_entries),
      queueHistory: await countWhere(client, "queue_history", IN_EDITION.entryChildren),
      reviews: await countWhere(client, "attempt_review", IN_EDITION.attemptChildren),
      reviewVersions: await countWhere(
        client,
        "attempt_review_versions",
        IN_EDITION.attemptChildren,
      ),
      judgingSessions: await countWhere(client, "judging_session", IN_EDITION.entryChildren),
      winners: await countWhere(client, "challenge_winners", IN_EDITION.challenge_winners),
      judgeAssignments: await countWhere(client, "enterprise_judges", IN_EDITION.enterprise_judges),
      queueGroupsRemoved: await countWhere(client, "queue_groups", IN_EDITION.queue_groups),
      queueGroupsRecreated: 0,
      queueGroupMembers: await countWhere(
        client,
        "queue_group_challenges",
        IN_EDITION.groupChildren,
      ),
      roomQueueAssignments: await countWhere(client, "room_queue_groups", IN_EDITION.roomChildren),
      roomEnterpriseAssignments: await countWhere(
        client,
        "room_enterprises",
        IN_EDITION.roomChildren,
      ),
      queueNotifications: await countWhere(
        client,
        "notification_outbox",
        `category IN ('queue', 'queue.staff')`,
      ),
      projectNotifications: await countWhere(client, "notification_outbox", `category = 'project'`),
      queuePreferences: await countWhere(
        client,
        "notification_preferences",
        `category IN ('queue', 'queue.staff')`,
      ),
      queueIdempotencyKeys: await countWhere(
        client,
        "idempotency_keys",
        qIdempotencyWhere,
        idempotencyParams,
      ),
    };

    // Review and queue history tables have no delete cascade by design: the
    // reset names every dependent table explicitly so no judging artifact is
    // left behind when its queue entry disappears.
    await client.query(`DELETE FROM attempt_review_versions WHERE ${IN_EDITION.attemptChildren}`);
    await client.query(`DELETE FROM attempt_review WHERE ${IN_EDITION.attemptChildren}`);
    await client.query(`DELETE FROM judging_session WHERE ${IN_EDITION.entryChildren}`);
    await client.query(`DELETE FROM queue_history WHERE ${IN_EDITION.entryChildren}`);
    await client.query(`DELETE FROM queue_entries WHERE ${IN_EDITION.queue_entries}`);
    await client.query(`DELETE FROM challenge_winners WHERE ${IN_EDITION.challenge_winners}`);
    await client.query(`DELETE FROM enterprise_judges WHERE ${IN_EDITION.enterprise_judges}`);
    await client.query(`DELETE FROM room_queue_groups WHERE ${IN_EDITION.roomChildren}`);
    await client.query(`DELETE FROM room_enterprises WHERE ${IN_EDITION.roomChildren}`);
    await client.query(`DELETE FROM queue_groups WHERE ${IN_EDITION.queue_groups}`);

    // Challenge definitions remain event configuration; the baseline
    // one-queue-per-challenge groups are rebuilt below.

    await client.query(`DELETE FROM submissions WHERE ${IN_EDITION.submissions}`);
    await client.query(`DELETE FROM repos WHERE ${IN_EDITION.repos}`);

    // Remove queued/inbox project and queue messages. An email already
    // delivered by a provider cannot be recalled; the audit trail remains.
    await client.query(
      `DELETE FROM notification_outbox WHERE category IN ('queue', 'queue.staff', 'project')`,
    );
    await client.query(
      `DELETE FROM notification_preferences WHERE category IN ('queue', 'queue.staff')`,
    );
    await client.query(
      `DELETE FROM idempotency_keys WHERE ${qIdempotencyWhere}`,
      idempotencyParams,
    );

    // Preserve room definitions, but return all room and queue controls to
    // their initial paused/default values.
    await client.query(`UPDATE rooms SET status = 'paused' WHERE ${IN_EDITION.rooms}`);
    await client.query(`
      INSERT INTO room_queue_state (room_id, is_paused)
      SELECT r.id, true
        FROM rooms r
       WHERE r.event_key = current_edition() AND NOT EXISTS (
         SELECT 1 FROM room_queue_state rqs WHERE rqs.room_id = r.id
       )
    `);
    await client.query(`
      UPDATE room_queue_state
         SET is_paused = true,
             max_in_waiting_area = 2,
             started_at = NULL
       WHERE ${IN_EDITION.roomChildren}
    `);
    await client.query(`
      UPDATE queue_settings
         SET handoff_buffer_minutes = 5,
             schedule_start_at = NULL,
             schedule_end_at = NULL,
             pre_call_notification_eta_minutes = 10,
             requeue_prompt_default = 'ask',
             called_too_long_threshold_minutes = 10
       WHERE id = 1
         AND current_edition() = COALESCE((SELECT event_key FROM event_config WHERE id = 1), 'default')
    `);

    counts.queueGroupsRecreated = await recreateDefaultQueueGroups(client);

    await audit(client, {
      actorId,
      entityType: "queue_reset",
      entityId: "all",
      action: "reset",
      before: counts,
      after: {
        projects: 0,
        queueEntries: 0,
        reviews: 0,
        judgingSessions: 0,
        queueGroups: counts.queueGroupsRecreated,
        challengeMappings: 0,
      },
      reason: "Super-admin reset of project, queue, and judging data",
      source: "admin",
    });

    return { ok: true, counts };
  });
}
