import { pool } from "../../db/pool.js";
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
 * snapshot, no transaction needed.
 */
export async function buildExportBundle(subjectUserId: number): Promise<Record<string, unknown>> {
  const { rows: userRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [subjectUserId]);
  const user = userRows[0];
  if (!user) throw new NotFoundError("User not found", { userId: subjectUserId });

  const [
    groups,
    capabilities,
    applications,
    submissions,
    devpostParticipant,
    judgingParticipation,
    activityLogs,
    checkInLogs,
    timeLogs,
    mealRedemptions,
    notificationPreferences,
    notificationOutbox,
    pushTokens,
    announcementReads,
    auditLog,
  ] = await Promise.all([
    pool
      .query(
        `SELECT g.id, g.name FROM permission_group_members m
           JOIN permission_groups g ON g.id = m.group_id
          WHERE m.user_id = $1 ORDER BY g.name`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    getEffectiveCapabilities(subjectUserId).then((caps) => [...caps]),
    pool
      .query(
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
      .then((r) => r.rows),
    pool
      .query(
        `SELECT r.id AS repo_id, r.name, r.description, r.github_url, r.devpost_url, r.demo_url,
                s.imported_from, s.created_at
           FROM submissions s
           JOIN repos r ON r.id = s.repo_id
          WHERE s.user_id = $1
          ORDER BY r.id`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT repo_id, email, name, surname, devpost_username, merge_status, linked_at
           FROM devpost_participants WHERE user_id = $1 ORDER BY repo_id`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
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
      .then((r) => r.rows),
    pool
      .query(
        `SELECT al.id, a.name AS activity_name, a.category, al.logged_at, al.notes
           FROM activity_logs al JOIN activities a ON a.id = al.activity_id
          WHERE al.user_id = $1 ORDER BY al.logged_at`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT id, badge_id, check_in_method, checked_in_at
           FROM check_in_logs WHERE user_id = $1 ORDER BY checked_in_at`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT id, kind, scanned_at
           FROM time_logs WHERE user_id = $1 ORDER BY scanned_at`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT al.id, a.name AS activity_name, al.logged_at, al.notes
           FROM activity_logs al JOIN activities a ON a.id = al.activity_id
          WHERE al.user_id = $1 AND a.category = 'meal' ORDER BY al.logged_at`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT category, channel, enabled FROM notification_preferences
          WHERE user_id = $1 ORDER BY category, channel`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT id, category, channel, status, sent_at, read_at, created_at
           FROM notification_outbox WHERE user_id = $1 ORDER BY id`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    // Device push token VALUE is deliberately omitted (device-routing secret,
    // not needed for data-subject transparency) — only metadata is exported.
    pool
      .query(
        `SELECT platform, created_at FROM push_tokens WHERE user_id = $1 ORDER BY created_at`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT an.announcement_id, a.title, an.read_at
           FROM announcement_reads an JOIN announcements a ON a.id = an.announcement_id
          WHERE an.user_id = $1 ORDER BY an.read_at`,
        [subjectUserId],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT id, actor_id, action, source, before, after, reason, created_at
           FROM audit_log WHERE entity_type = 'user' AND entity_id = $1::text
          ORDER BY created_at`,
        [String(subjectUserId)],
      )
      .then((r) => r.rows),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    subject: {
      id: user.id,
      email: user.email,
      emailVerified: user.email_verified,
      name: user.name,
      surname: user.surname,
      phone: user.phone,
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
    permissions: { groups, effectiveCapabilities: capabilities },
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
