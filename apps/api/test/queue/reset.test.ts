import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  addChallengeJudge,
  assignChallengeToRoom,
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
} from "./fixtures.js";

let app: App;

const resetBody = {
  confirmationPhrase: "WIPE_Q_DATA",
  acknowledgeIrreversible: true,
} as const;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  await pool.query(
    `UPDATE queue_settings
        SET handoff_buffer_minutes = 5,
            schedule_start_at = NULL,
            schedule_end_at = NULL,
            pre_call_notification_eta_minutes = 10,
            requeue_prompt_default = 'ask',
            called_too_long_threshold_minutes = 10
      WHERE id = 1`,
  );
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("POST /api/queue/admin/reset", () => {
  it("requires the wildcard super-admin capability and the exact server lock", async () => {
    const queueAdmin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/queue/admin/reset",
      headers: asUser(queueAdmin),
      payload: resetBody,
    });
    expect(forbidden.statusCode).toBe(403);

    const superAdmin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/queue/admin/reset",
      headers: asUser(superAdmin),
      payload: { confirmationPhrase: "WIPE_Q_DATA", acknowledgeIrreversible: false },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("atomically clears the project, import, queue, and judging slice", async () => {
    const superAdmin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const member = await createUser();
    const judge = await createUser();
    const { challengeIds } = await createEnterpriseChallenges(2, [
      [{ key: "clarity", type: "scale" }],
      [{ key: "impact", type: "scale" }],
    ]);
    const challengeOneId = challengeIds[0];
    if (challengeOneId === undefined || challengeIds[1] === undefined) {
      throw new Error("Expected two challenge fixtures");
    }
    await pool.query(`UPDATE challenges SET devpost_tags = $2::jsonb WHERE id = $1`, [
      challengeOneId,
      JSON.stringify(["best-ai"]),
    ]);

    const roomId = await createRoom({
      status: "active",
      isPaused: false,
      maxInWaitingArea: 5,
      desiredMinutesPerTeam: 15,
    });
    await assignChallengeToRoom(roomId, challengeOneId);
    await addChallengeJudge(challengeOneId, judge);

    const { repoId } = await createRepoWithTeam([member], "Imported project");
    await pool.query(`UPDATE repos SET devpost_url = $2 WHERE id = $1`, [
      repoId,
      "https://devpost.test/projects/imported-project",
    ]);
    await pool.query(`INSERT INTO devpost_prizes (name, last_batch) VALUES ('Best AI', 'batch-1')`);
    await pool.query(`INSERT INTO repo_devpost_prizes (repo_id, prize) VALUES ($1, 'Best AI')`, [
      repoId,
    ]);
    await pool.query(
      `INSERT INTO devpost_participants (repo_id, email, name, import_batch, user_id, merge_status)
       VALUES ($1, 'member@devpost.test', 'Member', 'batch-1', $2, 'auto_matched')`,
      [repoId, member],
    );

    const claimToken = "claim-token-for-reset-test";
    await pool.query(
      `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
       VALUES ($1, 'account_claim', 'claim@devpost.test', $2, now() + interval '1 hour')`,
      [claimToken, member],
    );
    await pool.query(
      `INSERT INTO notification_outbox (user_id, category, channel, payload)
       VALUES ($1, 'devpost', 'email', $2::jsonb),
              ($1, 'project', 'in_app', '{}'::jsonb),
              ($1, 'queue', 'in_app', '{}'::jsonb),
              ($1, 'queue.staff', 'in_app', '{}'::jsonb),
              ($1, 'application.decision', 'in_app', '{}'::jsonb)`,
      [member, JSON.stringify({ token: claimToken })],
    );
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'queue', 'push', false), ($1, 'queue.staff', 'push', false)`,
      [member],
    );

    const { rows: entries } = await pool.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, assigned_room_id, status, position)
       VALUES ($1, $2, $3, 'completed', 1)
       RETURNING id`,
      [challengeOneId, repoId, roomId],
    );
    const entryId = Number(entries[0].id);
    await pool.query(
      `INSERT INTO queue_history (queue_entry_id, actor_id, previous_status, new_status, action)
       VALUES ($1, $2, 'presenting', 'completed', 'complete')`,
      [entryId, superAdmin],
    );
    await pool.query(
      `INSERT INTO attempt_review (attempt_id, scores, notes, status)
       VALUES ($1, '{"clarity": 4}', 'reviewed', 'submitted')`,
      [entryId],
    );
    await pool.query(
      `INSERT INTO attempt_review_versions (attempt_id, author_id, changed_fields, previous, new)
       VALUES ($1, $2, ARRAY['clarity'], '{}', '{"clarity": 4}')`,
      [entryId, judge],
    );
    await pool.query(
      `INSERT INTO judging_session (judge_id, queue_entry_id, room_id, submitted_at)
       VALUES ($1, $2, $3, now())`,
      [judge, entryId, roomId],
    );
    await pool.query(
      `INSERT INTO challenge_winners (challenge_id, rank, repo_id, set_by)
       VALUES ($1, 1, $2, $3)`,
      [challengeOneId, repoId, superAdmin],
    );

    await pool.query(
      `INSERT INTO idempotency_keys (key, scope, request_hash, response_status, response_body)
       VALUES ('old-queue-key', 'POST /api/queue/entries u:999', 'old-hash', 200, '{}'::jsonb),
              ('unrelated-key', 'POST /api/applications/confirm u:999', 'other-hash', 200, '{}'::jsonb)`,
    );
    await pool.query(
      `UPDATE queue_settings
          SET handoff_buffer_minutes = 12,
              pre_call_notification_eta_minutes = 3,
              requeue_prompt_default = 'top',
              called_too_long_threshold_minutes = 20
        WHERE id = 1`,
    );

    const { rows: usersBefore } = await pool.query(`SELECT count(*)::int AS count FROM users`);
    const resetKey = "reset-key-for-integration-test";
    const first = await app.inject({
      method: "POST",
      url: "/api/queue/admin/reset",
      headers: { ...asUser(superAdmin), "idempotency-key": resetKey },
      payload: resetBody,
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    expect(first.json().counts).toMatchObject({
      projects: 1,
      projectMembers: 1,
      importedParticipants: 1,
      importedPrizes: 1,
      projectPrizeLinks: 1,
      queueEntries: 1,
      queueHistory: 1,
      reviews: 1,
      reviewVersions: 1,
      judgingSessions: 1,
      winners: 1,
      judgeAssignments: 1,
      queueGroupsRemoved: 2,
      queueGroupsRecreated: 2,
      queueGroupMembers: 2,
      roomQueueAssignments: 1,
      roomEnterpriseAssignments: 1,
      queueNotifications: 2,
      projectNotifications: 1,
      devpostClaimNotifications: 1,
      queuePreferences: 2,
      queueIdempotencyKeys: 2,
      devpostClaimTokens: 1,
      challengeMappingsReset: 1,
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/queue/admin/reset",
      headers: { ...asUser(superAdmin), "idempotency-key": resetKey },
      payload: resetBody,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(first.json());

    const emptyTables = [
      "repos",
      "submissions",
      "devpost_participants",
      "devpost_prizes",
      "repo_devpost_prizes",
      "queue_entries",
      "queue_history",
      "attempt_review",
      "attempt_review_versions",
      "judging_session",
      "challenge_winners",
      "enterprise_judges",
      "room_queue_groups",
      "room_enterprises",
    ];
    for (const table of emptyTables) {
      const { rows } = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
      expect(rows[0].count, table).toBe(0);
    }

    const { rows: challenges } = await pool.query(
      `SELECT c.id, c.title, c.devpost_tags, count(qgc.challenge_id)::int AS group_members
         FROM challenges c
         LEFT JOIN queue_group_challenges qgc ON qgc.challenge_id = c.id
        GROUP BY c.id, c.title, c.devpost_tags
        ORDER BY c.id`,
    );
    expect(challenges).toHaveLength(2);
    expect(challenges[0].title).toMatch(/^Challenge 1 /);
    expect(challenges[1].title).toMatch(/^Challenge 2 /);
    expect(challenges.every((row) => row.devpost_tags.length === 0)).toBe(true);
    expect(challenges.every((row) => row.group_members === 1)).toBe(true);

    const room = (await pool.query(`SELECT status FROM rooms WHERE id = $1`, [roomId])).rows[0];
    expect(room.status).toBe("paused");
    const roomState = (
      await pool.query(`SELECT * FROM room_queue_state WHERE room_id = $1`, [roomId])
    ).rows[0];
    expect(roomState).toMatchObject({
      is_paused: true,
      max_in_waiting_area: 2,
      desired_minutes_per_team: 8,
      started_at: null,
    });
    const settings = (await pool.query(`SELECT * FROM queue_settings WHERE id = 1`)).rows[0];
    expect(settings).toMatchObject({
      handoff_buffer_minutes: 5,
      schedule_start_at: null,
      schedule_end_at: null,
      pre_call_notification_eta_minutes: 10,
      requeue_prompt_default: "ask",
      called_too_long_threshold_minutes: 10,
    });

    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM notification_outbox WHERE category = 'application.decision'`,
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (await pool.query(`SELECT count(*)::int AS count FROM email_verification_tokens`)).rows[0]
        .count,
    ).toBe(0);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM idempotency_keys WHERE key = 'old-queue-key'`,
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM idempotency_keys WHERE key IN ('reset-key-for-integration-test', 'unrelated-key')`,
        )
      ).rows[0].count,
    ).toBe(2);
    expect((await pool.query(`SELECT count(*)::int AS count FROM users`)).rows[0].count).toBe(
      usersBefore[0].count,
    );

    const { rows: auditRows } = await pool.query(
      `SELECT actor_id, entity_type, entity_id, action, source, reason
         FROM audit_log
        WHERE entity_type = 'queue_reset'`,
    );
    expect(auditRows).toEqual([
      expect.objectContaining({
        actor_id: superAdmin,
        entity_type: "queue_reset",
        entity_id: "all",
        action: "reset",
        source: "admin",
      }),
    ]);
  });
});
