import type { Queryable } from "../../db/pool.js";
import { withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";

/**
 * The destructive reset keeps event identity and challenge definitions, but
 * removes every project/import, queue, and judging artifact so the event can
 * start the Q flow again (H16-H40, H53).
 */
export interface JudgingDataResetResult {
  ok: true;
  counts: {
    projects: number;
    projectMembers: number;
    importedParticipants: number;
    importedPrizes: number;
    projectPrizeLinks: number;
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
    devpostClaimNotifications: number;
    queuePreferences: number;
    queueIdempotencyKeys: number;
    devpostClaimTokens: number;
    challengeMappingsReset: number;
  };
}

interface IdempotencyExclusion {
  key: string | null;
  scope: string | null;
}

const Q_IDEMPOTENCY_SCOPE = `(
  scope LIKE '% /api/queue%'
  OR scope LIKE '% /api/repos%'
  OR scope LIKE '% /api/projects%'
  OR scope LIKE '% /api/me/projects%'
  OR scope LIKE '% /api/devpost%'
  OR scope LIKE '% /api/enterprises/%/queue-groups%'
)`;

async function countRows(client: Queryable, table: string): Promise<number> {
  const { rows } = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
  return Number(rows[0]?.count ?? 0);
}

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
  idempotency: IdempotencyExclusion = { key: null, scope: null },
): Promise<JudgingDataResetResult> {
  return withTransaction(async (client) => {
    // Lock in a stable alphabetical order so two destructive requests cannot
    // deadlock. These are the Q/project tables touched by H16-H40.
    await client.query(`
      LOCK TABLE
        attempt_review,
        attempt_review_versions,
        challenge_winners,
        challenges,
        devpost_participants,
        devpost_prizes,
        email_verification_tokens,
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
        repo_devpost_prizes,
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
      projects: await countRows(client, "repos"),
      projectMembers: await countRows(client, "submissions"),
      importedParticipants: await countRows(client, "devpost_participants"),
      importedPrizes: await countRows(client, "devpost_prizes"),
      projectPrizeLinks: await countRows(client, "repo_devpost_prizes"),
      queueEntries: await countRows(client, "queue_entries"),
      queueHistory: await countRows(client, "queue_history"),
      reviews: await countRows(client, "attempt_review"),
      reviewVersions: await countRows(client, "attempt_review_versions"),
      judgingSessions: await countRows(client, "judging_session"),
      winners: await countRows(client, "challenge_winners"),
      judgeAssignments: await countRows(client, "enterprise_judges"),
      queueGroupsRemoved: await countRows(client, "queue_groups"),
      queueGroupsRecreated: 0,
      queueGroupMembers: await countRows(client, "queue_group_challenges"),
      roomQueueAssignments: await countRows(client, "room_queue_groups"),
      roomEnterpriseAssignments: await countRows(client, "room_enterprises"),
      queueNotifications: await countWhere(
        client,
        "notification_outbox",
        `category IN ('queue', 'queue.staff')`,
      ),
      projectNotifications: await countWhere(client, "notification_outbox", `category = 'project'`),
      devpostClaimNotifications: await countWhere(
        client,
        "notification_outbox",
        `category = 'devpost'`,
      ),
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
      devpostClaimTokens: await countWhere(
        client,
        "email_verification_tokens",
        `type = 'account_claim'
         AND EXISTS (
           SELECT 1 FROM notification_outbox n
            WHERE n.category = 'devpost'
              AND n.payload->>'token' = email_verification_tokens.token
         )`,
      ),
      challengeMappingsReset: await countWhere(client, "challenges", `devpost_tags <> '[]'::jsonb`),
    };

    // Review and queue history tables have no delete cascade by design: the
    // reset names every dependent table explicitly so no judging artifact is
    // left behind when its queue entry disappears.
    await client.query(`DELETE FROM attempt_review_versions`);
    await client.query(`DELETE FROM attempt_review`);
    await client.query(`DELETE FROM judging_session`);
    await client.query(`DELETE FROM queue_history`);
    await client.query(`DELETE FROM queue_entries`);
    await client.query(`DELETE FROM challenge_winners`);
    await client.query(`DELETE FROM enterprise_judges`);
    await client.query(`DELETE FROM room_queue_groups`);
    await client.query(`DELETE FROM room_enterprises`);
    await client.query(`DELETE FROM queue_groups`);

    // Challenge definitions remain event configuration. Their Devpost tags
    // are the project-to-challenge import mapping, so reset those mappings
    // while rebuilding a clean one-queue-per-challenge baseline below.
    await client.query(`UPDATE challenges SET devpost_tags = '[]'::jsonb`);

    await client.query(`DELETE FROM submissions`);
    await client.query(`DELETE FROM devpost_participants`);
    await client.query(`DELETE FROM repo_devpost_prizes`);
    await client.query(`DELETE FROM devpost_prizes`);
    await client.query(`DELETE FROM repos`);

    // Remove queued/inbox project and queue messages. An email already
    // delivered by a provider cannot be recalled; the audit trail remains.
    await client.query(`
      DELETE FROM email_verification_tokens
       WHERE type = 'account_claim'
         AND EXISTS (
           SELECT 1 FROM notification_outbox n
            WHERE n.category = 'devpost'
              AND n.payload->>'token' = email_verification_tokens.token
         )
    `);
    await client.query(
      `DELETE FROM notification_outbox WHERE category IN ('queue', 'queue.staff', 'project', 'devpost')`,
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
    await client.query(`UPDATE rooms SET status = 'paused'`);
    await client.query(`
      INSERT INTO room_queue_state (room_id, is_paused)
      SELECT r.id, true
        FROM rooms r
       WHERE NOT EXISTS (
         SELECT 1 FROM room_queue_state rqs WHERE rqs.room_id = r.id
       )
    `);
    await client.query(`
      UPDATE room_queue_state
         SET is_paused = true,
             max_in_waiting_area = 2,
             desired_minutes_per_team = 8,
             started_at = NULL
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
