import { pool, type Queryable } from "../../db/pool.js";
import { getEffectiveCapabilities } from "../../lib/capabilities.js";
import { NotFoundError } from "../../lib/errors.js";

/**
 * H54 personal-data export bundle. Every query is explicitly scoped to
 * `subjectUserId` — never a bulk table dump — and deliberately excludes rows
 * reachable only because the subject acted AS STAFF on someone else's data
 * (queue_history.actor_id, applicant_reviews.author_id on other users'
 * responses, judging_session.judge_id, attempt_review_versions.author_id,
 * check_in_logs.staff_id / time_logs.scanned_by / activity_logs.logged_by
 * when the subject is the scanner, not the scanned). Read-only point-in-time
 * snapshot. Callers that need a race-free snapshot pass a transaction client.
 */
export async function buildExportBundle(
  subjectUserId: number,
  db: Queryable = pool,
): Promise<Record<string, unknown>> {
  const { rows: userRows } = await db.query(
    `SELECT * FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        AND is_test_account = false
      FOR SHARE`,
    [subjectUserId],
  );
  const user = userRows[0];
  if (!user) throw new NotFoundError("User not found", { userId: subjectUserId });

  // Keep these reads sequential. The worker passes a single PoolClient while
  // holding the user share lock; Promise.all on that client can interleave
  // protocol operations and defeats the transaction's simple lock model.
  const roles = (
    await db.query(
      `SELECT r.id, r.name FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1 ORDER BY r.position DESC`,
      [subjectUserId],
    )
  ).rows;
  const capabilities = [...(await getEffectiveCapabilities(subjectUserId, undefined, db))];
  const applications = (
    await db.query(
      `SELECT ar.id, ar.application_id, a.name AS application_name, a.type AS application_type,
              ar.status, ar.responses, ar.submitted_at, ar.confirmed_at, ar.declined_at,
              (SELECT jsonb_agg(jsonb_build_object('authorId', rv.author_id, 'score', rv.score, 'notes', rv.notes))
                 FROM applicant_reviews rv WHERE rv.response_id = ar.id) AS reviews
         FROM application_responses ar
         JOIN applications a ON a.id = ar.application_id
        WHERE ar.user_id = $1
        ORDER BY ar.id`,
      [subjectUserId],
    )
  ).rows;
  const submissions = (
    await db.query(
      `SELECT r.id AS repo_id, r.name, r.description, r.github_url, r.devpost_url, r.demo_url,
              s.imported_from, s.created_at
         FROM submissions s
         JOIN repos r ON r.id = s.repo_id
        WHERE s.user_id = $1
        ORDER BY r.id`,
      [subjectUserId],
    )
  ).rows;
  const devpostParticipant = (
    await db.query(
      `SELECT repo_id, email, name, surname, devpost_username, merge_status, linked_at
         FROM devpost_participants WHERE user_id = $1 ORDER BY repo_id`,
      [subjectUserId],
    )
  ).rows;
  const judgingParticipation = (
    await db.query(
      `SELECT qe.id AS queue_entry_id, qe.challenge_id, c.title AS challenge_title,
              r.id AS repo_id, r.name AS repo_name, qe.status, qe.completed_at,
              ar.scores, ar.notes AS review_notes, ar.status AS review_status
         FROM submissions s
         JOIN queue_entries qe ON qe.repo_id = s.repo_id
         JOIN challenges c ON c.id = qe.challenge_id
         JOIN repos r ON r.id = qe.repo_id
         LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
        WHERE s.user_id = $1
        ORDER BY qe.id`,
      [subjectUserId],
    )
  ).rows;
  const activityLogs = (
    await db.query(
      `SELECT al.id, a.name AS activity_name, a.category, al.logged_at, al.notes
         FROM activity_logs al JOIN activities a ON a.id = al.activity_id
        WHERE al.user_id = $1 ORDER BY al.logged_at`,
      [subjectUserId],
    )
  ).rows;
  const checkInLogs = (
    await db.query(
      `SELECT id, badge_id, check_in_method, checked_in_at
         FROM check_in_logs WHERE user_id = $1 ORDER BY checked_in_at`,
      [subjectUserId],
    )
  ).rows;
  const timeLogs = (
    await db.query(
      `SELECT id, kind, scanned_at
         FROM time_logs WHERE user_id = $1 ORDER BY scanned_at`,
      [subjectUserId],
    )
  ).rows;
  const mealRedemptions = (
    await db.query(
      `SELECT al.id, a.name AS activity_name, al.logged_at, al.notes
         FROM activity_logs al JOIN activities a ON a.id = al.activity_id
        WHERE al.user_id = $1 AND a.category = 'meal' ORDER BY al.logged_at`,
      [subjectUserId],
    )
  ).rows;
  const notificationPreferences = (
    await db.query(
      `SELECT category, channel, enabled FROM notification_preferences
        WHERE user_id = $1 ORDER BY category, channel`,
      [subjectUserId],
    )
  ).rows;
  const notificationOutbox = (
    await db.query(
      `SELECT id, category, channel, status, sent_at, read_at, created_at
         FROM notification_outbox WHERE user_id = $1 ORDER BY id`,
      [subjectUserId],
    )
  ).rows;
  // Device push token VALUE is deliberately omitted (device-routing secret,
  // not needed for data-subject transparency) — only metadata is exported.
  const pushTokens = (
    await db.query(
      `SELECT platform, created_at FROM push_tokens WHERE user_id = $1 ORDER BY created_at`,
      [subjectUserId],
    )
  ).rows;
  const announcementReads = (
    await db.query(
      `SELECT an.announcement_id, a.title, an.read_at
         FROM announcement_reads an JOIN announcements a ON a.id = an.announcement_id
        WHERE an.user_id = $1 ORDER BY an.read_at`,
      [subjectUserId],
    )
  ).rows;
  const auditLog = (
    await db.query(
      `SELECT id, actor_id, action, source, before, after, reason, created_at
         FROM audit_log WHERE entity_type = 'user' AND entity_id = $1::text
        ORDER BY created_at`,
      [String(subjectUserId)],
    )
  ).rows;

  return {
    generatedAt: new Date().toISOString(),
    subject: {
      id: user.id,
      email: user.email,
      emailVerified: user.email_verified,
      name: user.name,
      surname: user.surname,
      dni: user.dni,
      image: user.image,
      badgeId: user.badge_id,
      badgeIdHistory: user.badge_id_history,
      foodIntolerances: user.food_intolerances,
      foodIntoleranceNotes: user.food_intolerance_notes,
      dietaryDataState: user.dietary_data_state,
      universityId: user.university_id,
      shirtSize: user.shirt_size,
      language: user.language,
      secondaryEmail: user.secondary_email,
      secondaryEmailVerified: user.secondary_email_verified_at !== null,
      notes: user.notes,
      createdAt: user.created_at,
    },
    permissions: { roles, effectiveCapabilities: capabilities },
    applications,
    projects: { submissions, devpostParticipant },
    judgingParticipation,
    presence: { activityLogs, checkInLogs, timeLogs },
    meals: { redemptions: mealRedemptions },
    notifications: {
      preferences: notificationPreferences,
      outbox: notificationOutbox,
      pushTokens,
      announcementReads,
    },
    audit: auditLog,
  };
}
