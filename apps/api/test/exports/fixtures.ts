import { pool } from "../../src/db/pool.js";
import { ensureApplicationFormVersion } from "../helpers.js";

/** H54 export-suite fixtures. Direct SQL inserts — other modules' routes are out of scope. */

export async function createApplicationResponse(
  userId: number,
  overrides: Partial<{
    status: string;
    appName: string;
    appType: string;
    responses: Record<string, unknown>;
  }> = {},
): Promise<{ responseId: number; applicationId: number }> {
  const app = await pool.query(
    `INSERT INTO applications (name, type, template) VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
    [overrides.appName ?? `app-${crypto.randomUUID()}`, overrides.appType ?? "participant"],
  );
  const applicationId = app.rows[0].id;
  const formVersionId = await ensureApplicationFormVersion(applicationId);
  const resp = await pool.query(
    `INSERT INTO application_responses
       (user_id, application_id, application_form_version_id, status, responses, submitted_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now()) RETURNING id`,
    [
      userId,
      applicationId,
      formVersionId,
      overrides.status ?? "review",
      JSON.stringify(overrides.responses ?? {}),
    ],
  );
  return { responseId: resp.rows[0].id, applicationId };
}

export async function addReview(
  responseId: number,
  authorId: number,
  score: number,
  notes?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO applicant_reviews (response_id, author_id, score, notes) VALUES ($1, $2, $3, $4)`,
    [responseId, authorId, score, notes ?? null],
  );
}

export async function createChallenge(ownerId: number, title?: string): Promise<number> {
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, ownerId],
  );
  const { rows } = await pool.query(
    `INSERT INTO challenges (author, title) VALUES ($1, $2) RETURNING id`,
    [sponsor.rows[0].id, title ?? `Challenge ${crypto.randomUUID().slice(0, 8)}`],
  );
  return rows[0].id;
}

export async function createRepoWithSubmission(userId: number, name?: string): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [
    name ?? `repo-${crypto.randomUUID().slice(0, 8)}`,
  ]);
  const repoId = rows[0].id;
  await pool.query(`INSERT INTO submissions (repo_id, user_id) VALUES ($1, $2)`, [repoId, userId]);
  return repoId;
}

export async function enqueueRepo(challengeId: number, repoId: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status) VALUES ($1, $2, 'completed') RETURNING id`,
    [challengeId, repoId],
  );
  return rows[0].id;
}

export async function setAttemptReview(
  attemptId: number,
  authorId: number,
  scores: Record<string, number>,
): Promise<void> {
  await pool.query(
    `INSERT INTO attempt_review (attempt_id, scores, status) VALUES ($1, $2, 'submitted')`,
    [attemptId, JSON.stringify(scores)],
  );
  await pool.query(
    `INSERT INTO attempt_review_versions (attempt_id, author_id, changed_fields, new)
     VALUES ($1, $2, $3, $4)`,
    [attemptId, authorId, ["scores"], JSON.stringify(scores)],
  );
}

export async function joinJudgingSession(judgeId: number, entryId: number): Promise<void> {
  await pool.query(`INSERT INTO judging_session (judge_id, queue_entry_id) VALUES ($1, $2)`, [
    judgeId,
    entryId,
  ]);
}

export async function createActivity(
  opts: { category?: string; name?: string } = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO activities (name, category) VALUES ($1, $2) RETURNING id`,
    [opts.name ?? `Activity ${crypto.randomUUID().slice(0, 8)}`, opts.category ?? "general"],
  );
  return rows[0].id;
}

export async function createMeal(name = "Dinner"): Promise<number> {
  return createActivity({ category: "meal", name });
}

export async function checkIn(userId: number, staffId: number): Promise<void> {
  await pool.query(
    `INSERT INTO check_in_logs (user_id, staff_id, check_in_method) VALUES ($1, $2, 'manual')`,
    [userId, staffId],
  );
}

export async function timeLog(userId: number, scannedBy: number, kind = "in"): Promise<void> {
  await pool.query(`INSERT INTO time_logs (user_id, kind, scanned_by) VALUES ($1, $2, $3)`, [
    userId,
    kind,
    scannedBy,
  ]);
}

export async function activityLog(
  userId: number,
  activityId: number,
  loggedBy: number,
  notes?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO activity_logs (user_id, activity_id, logged_by, notes) VALUES ($1, $2, $3, $4)`,
    [userId, activityId, loggedBy, notes ?? null],
  );
}

export async function setNotificationPreference(
  userId: number,
  category = "queue",
  channel: "in_app" | "email" | "push" = "in_app",
): Promise<void> {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, channel) VALUES ($1, $2, $3)`,
    [userId, category, channel],
  );
}

export async function queueNotification(userId: number, category = "queue"): Promise<void> {
  await pool.query(
    `INSERT INTO notification_outbox (user_id, category, channel, payload) VALUES ($1, $2, 'in_app', $3)`,
    [userId, category, JSON.stringify({ msg: "hi" })],
  );
}

export async function registerPushToken(userId: number, token?: string): Promise<void> {
  await pool.query(`INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, 'ios')`, [
    userId,
    token ?? `expo-${crypto.randomUUID()}`,
  ]);
}

export async function createAnnouncement(authorId: number, title = "Ping"): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO announcements (author_id, title, body) VALUES ($1, $2, 'body') RETURNING id`,
    [authorId, title],
  );
  return rows[0].id;
}

export async function markAnnouncementRead(announcementId: number, userId: number): Promise<void> {
  await pool.query(`INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1, $2)`, [
    announcementId,
    userId,
  ]);
}

/**
 * Broadcast counter: sse.ts INCRs `sse:seq:<topic>` once per broadcast, so
 * the counter delta == number of broadcasts on that topic.
 */
export async function broadcastCount(topic: string): Promise<number> {
  const { valkey } = await import("../../src/lib/valkey.js");
  const v = await valkey.get(`sse:seq:${topic}`);
  return v ? Number(v) : 0;
}
