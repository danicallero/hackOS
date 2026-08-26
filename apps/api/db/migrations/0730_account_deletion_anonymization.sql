-- 0730_account_deletion_anonymization.sql — H54 account lifecycle.
--
-- A user row is an authenticated identity, not an anonymous audit subject.
-- Once a participant has operational history, the application migrates the
-- small attendance record that must survive to anonymous_participants and
-- deletes the users row. There is deliberately no mapping table.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN account_state text NOT NULL DEFAULT 'active'
    CHECK (account_state IN ('active', 'removal_pending')),
  ADD COLUMN removal_action text
    CHECK (removal_action IS NULL OR removal_action IN ('delete', 'anonymize')),
  ADD COLUMN removal_started_at timestamptz;

COMMENT ON COLUMN users.account_state IS
  'H54 lifecycle gate: active writers are rejected once removal_pending is committed.';
COMMENT ON COLUMN users.removal_action IS
  'H54 action selected while the user row is locked; prevents a retry from changing mode.';

CREATE TABLE anonymous_participants (
  id uuid PRIMARY KEY,
  age integer CHECK (age IS NULL OR age BETWEEN 0 AND 150),
  gender text,
  university text,
  degree text,
  graduation_year smallint CHECK (
    graduation_year IS NULL OR graduation_year BETWEEN 1900 AND 2200
  ),
  origin_city text,
  guaranteed_presence_minutes integer NOT NULL DEFAULT 0
    CHECK (guaranteed_presence_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE anonymous_participants IS
  'H54 permanent minimum audit subject. id is random and has no relationship to users.id.';
COMMENT ON COLUMN anonymous_participants.guaranteed_presence_minutes IS
  'H24 verified/guaranteed venue time, rounded down to complete minutes at anonymization.';

-- Create the disconnected-scanner revocation set before the legacy conversion
-- below. 0731 keeps the same objects for fresh installs; defining them here
-- means an upgrade can capture credentials before deleting old users (H54).
CREATE TABLE IF NOT EXISTS scanner_revoked_badges (
  badge_id text PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS scanner_revoked_badges_expiry ON scanner_revoked_badges (expires_at);
CREATE TABLE IF NOT EXISTS scanner_revoked_tickets (
  ticket_token text PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS scanner_revoked_tickets_expiry ON scanner_revoked_tickets (expires_at);

ALTER TABLE check_in_logs
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN staff_id DROP NOT NULL,
  ADD COLUMN anonymous_participant_id uuid REFERENCES anonymous_participants(id);

ALTER TABLE time_logs
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN anonymous_participant_id uuid REFERENCES anonymous_participants(id);

ALTER TABLE check_in_logs
  ADD CONSTRAINT check_in_logs_subject_check
    CHECK ((user_id IS NULL) <> (anonymous_participant_id IS NULL));

ALTER TABLE time_logs
  ADD CONSTRAINT time_logs_subject_check
    CHECK ((user_id IS NULL) <> (anonymous_participant_id IS NULL));

CREATE INDEX check_in_logs_anonymous_participant
  ON check_in_logs (anonymous_participant_id)
  WHERE anonymous_participant_id IS NOT NULL;
CREATE INDEX time_logs_anonymous_participant
  ON time_logs (anonymous_participant_id)
  WHERE anonymous_participant_id IS NOT NULL;

-- Actor provenance is not part of the anonymous participant audit set. Make
-- those authors nullable so removal can erase the actor without retaining a
-- fake user row. Domain records whose subject was the departing person are
-- deleted or moved by the H54 service below; these columns only cover actions
-- they performed for somebody else.
ALTER TABLE universities ALTER COLUMN proposed_by DROP NOT NULL;
ALTER TABLE food_intolerances ALTER COLUMN proposed_by DROP NOT NULL;
ALTER TABLE queue_history ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE attempt_review_versions ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE judging_session ALTER COLUMN judge_id DROP NOT NULL;
ALTER TABLE announcements ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE meal_scan_batches ALTER COLUMN submitted_by DROP NOT NULL;
ALTER TABLE challenge_winners ALTER COLUMN set_by DROP NOT NULL;
ALTER TABLE data_subject_requests
  ALTER COLUMN subject_user_id DROP NOT NULL,
  ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE activity_logs ALTER COLUMN logged_by DROP NOT NULL;

CREATE INDEX IF NOT EXISTS data_subject_requests_subject_nullable
  ON data_subject_requests (subject_user_id)
  WHERE subject_user_id IS NOT NULL;

-- Retire the previous in-place anonymization implementation. Existing rows
-- marked anonymized_at predate this separation and have no trustworthy
-- guaranteed-time value (the old code never stored one). Move their raw door
-- and accreditation timestamps to a random anonymous subject, erase all
-- remaining identity-bearing relationships, then remove the old user row.
-- The temporary table exists only inside this migration transaction and is
-- dropped automatically; it is not a reversible lookup table.
CREATE TEMP TABLE legacy_anonymized_users ON COMMIT DROP AS
SELECT id AS old_user_id, gen_random_uuid() AS anonymous_id, university_id,
       email, secondary_email, name, surname, dni,
       array_remove(array_cat(badge_id_history, ARRAY[badge_id]), NULL) AS badge_ids
  FROM users
 WHERE anonymized_at IS NOT NULL;

INSERT INTO scanner_revoked_badges (badge_id, revoked_at, expires_at)
SELECT DISTINCT badge_id, clock_timestamp(),
       GREATEST(
         COALESCE((SELECT event_ends_at + interval '1 day' FROM event_config WHERE id = 1), clock_timestamp() + interval '1 day'),
         clock_timestamp() + interval '1 day'
       )
  FROM legacy_anonymized_users legacy
 CROSS JOIN LATERAL unnest(legacy.badge_ids) AS badges(badge_id)
 WHERE badge_id IS NOT NULL
ON CONFLICT (badge_id) DO UPDATE
  SET revoked_at = EXCLUDED.revoked_at,
      expires_at = GREATEST(scanner_revoked_badges.expires_at, EXCLUDED.expires_at);

INSERT INTO scanner_revoked_tickets (ticket_token, revoked_at, expires_at)
SELECT DISTINCT t.token, clock_timestamp(),
       GREATEST(
         COALESCE((SELECT event_ends_at + interval '1 day' FROM event_config WHERE id = 1), clock_timestamp() + interval '1 day'),
         clock_timestamp() + interval '1 day'
       )
  FROM tickets t
  JOIN legacy_anonymized_users legacy ON legacy.old_user_id = t.user_id
ON CONFLICT (ticket_token) DO UPDATE
  SET revoked_at = EXCLUDED.revoked_at,
      expires_at = GREATEST(scanner_revoked_tickets.expires_at, EXCLUDED.expires_at);

INSERT INTO anonymous_participants (id, university)
SELECT anonymous_id,
       (SELECT name FROM universities WHERE id = legacy.university_id)
  FROM legacy_anonymized_users AS legacy;

UPDATE check_in_logs cil
   SET user_id = NULL,
       anonymous_participant_id = legacy.anonymous_id,
       badge_id = NULL,
       notes = NULL,
       staff_id = NULL
  FROM legacy_anonymized_users legacy
 WHERE cil.user_id = legacy.old_user_id;

UPDATE time_logs tl
   SET user_id = NULL,
       anonymous_participant_id = legacy.anonymous_id,
       notes = NULL,
       scanned_by = NULL
  FROM legacy_anonymized_users legacy
 WHERE tl.user_id = legacy.old_user_id;

UPDATE permission_group_members SET assigned_by = NULL
 WHERE assigned_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE universities SET proposed_by = NULL
 WHERE proposed_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE enterprises SET director_id = NULL
 WHERE director_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE enterprise_invite_links SET created_by = NULL
 WHERE created_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE user_invite_links SET created_by = NULL
 WHERE created_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE queue_history SET actor_id = NULL
 WHERE actor_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE attempt_review_versions SET author_id = NULL
 WHERE author_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE judging_session SET judge_id = NULL
 WHERE judge_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE devpost_participants SET linked_by = NULL
 WHERE linked_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE activity_logs SET logged_by = NULL
 WHERE logged_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE check_in_logs SET staff_id = NULL
 WHERE staff_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE time_logs SET scanned_by = NULL
 WHERE scanned_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE food_intolerances SET proposed_by = NULL
 WHERE proposed_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE application_responses SET referrer_user_id = NULL
 WHERE referrer_user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM applicant_reviews
 WHERE author_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE announcements SET author_id = NULL
 WHERE author_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE meal_scan_batches SET submitted_by = NULL
 WHERE submitted_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE audit_log SET actor_id = NULL
 WHERE actor_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE challenge_versions SET editor_id = NULL
 WHERE editor_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE challenge_winners SET set_by = NULL
 WHERE set_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE room_enterprises SET assigned_by = NULL
 WHERE assigned_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE room_queue_groups SET assigned_by = NULL
 WHERE assigned_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE manual_attendee_roles SET assigned_by = NULL
 WHERE assigned_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE enterprise_judges SET added_by = NULL
 WHERE added_by IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE queue_groups SET created_by = NULL
 WHERE created_by IN (SELECT old_user_id FROM legacy_anonymized_users);
-- schedule_owners requires exactly one of user_id/free_text_name. Never turn
-- an old account into a free-text copy of its name: delete rows owned by that
-- account, then detach authorship from rows owned by somebody else (H54).
DELETE FROM schedule_owners
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE schedule_owners SET assigned_by = NULL
 WHERE assigned_by IN (SELECT old_user_id FROM legacy_anonymized_users);

DELETE FROM applicant_reviews
 WHERE response_id IN (
   SELECT id FROM application_responses
    WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
 )
 OR author_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM application_responses
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM submissions
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM devpost_participants
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM enterprise_invite_link_redemptions
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
    OR lower(email) IN (
      SELECT lower(email) FROM legacy_anonymized_users WHERE email IS NOT NULL
      UNION
      SELECT lower(secondary_email) FROM legacy_anonymized_users WHERE secondary_email IS NOT NULL
    );
DELETE FROM user_invite_link_redemptions
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
    OR lower(email) IN (
      SELECT lower(email) FROM legacy_anonymized_users WHERE email IS NOT NULL
      UNION
      SELECT lower(secondary_email) FROM legacy_anonymized_users WHERE secondary_email IS NOT NULL
    );
DELETE FROM activity_logs
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM enterprise_judges
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
-- A sponsor row may be the non-null author anchor of a challenge. Preserve
-- that organisation-owned anchor while removing the person relationship; an
-- unconditional delete would violate challenges.author's NO ACTION FK.
UPDATE sponsors s
   SET user_id = NULL
 WHERE s.user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
   AND EXISTS (SELECT 1 FROM challenges c WHERE c.author = s.id);
DELETE FROM sponsors
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM judging_session
 WHERE judge_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM manual_attendee_roles
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM announcement_reads
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM announcement_recipients
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM notification_preferences
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM notification_outbox
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM wallet_pass_devices
 WHERE pass_id IN (
   SELECT id FROM wallet_passes
    WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
 );
DELETE FROM wallet_passes
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM tickets
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM push_tokens
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM sessions
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM accounts
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM email_verification_tokens
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
-- Better Auth's `verifications` table intentionally has no user FK. Its
-- identifier is commonly the email address for email-verification and
-- password-reset flows, so an FK-only cleanup would leave a direct identity
-- copy behind after the legacy user row is removed.
DELETE FROM verifications
 WHERE lower(identifier) IN (
         SELECT lower(email) FROM legacy_anonymized_users WHERE email IS NOT NULL
         UNION
         SELECT lower(secondary_email) FROM legacy_anonymized_users WHERE secondary_email IS NOT NULL
       )
    OR identifier IN (SELECT old_user_id::text FROM legacy_anonymized_users);
DELETE FROM data_subject_requests
 WHERE subject_user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
    OR requested_by IN (SELECT old_user_id FROM legacy_anonymized_users);
-- Old in-place anonymization rows could have left the original identifier in
-- JSON snapshots/reasons even after their actor FK was nulled. Delete those
-- rows rather than attempting to rewrite arbitrary historical payloads. The
-- temporary source table is dropped at commit and is never a mapping table.
DELETE FROM audit_log al
 WHERE al.actor_id IN (SELECT old_user_id FROM legacy_anonymized_users)
    OR (
      al.entity_type = ANY(ARRAY['user', 'badge', 'accreditation', 'presence', 'meal', 'activity'])
      AND al.entity_id IN (SELECT old_user_id::text FROM legacy_anonymized_users)
    )
    OR EXISTS (
      SELECT 1
        FROM legacy_anonymized_users legacy
       WHERE coalesce(al.before::text, '') ~ (
               '"(userId|user_id|subjectUserId|subject_user_id|actorId|actor_id|targetId|target_id|authorId|author_id|judgeId|judge_id|staffId|staff_id|createdBy|created_by|assignedBy|assigned_by|setBy|set_by|linkedBy|linked_by|loggedBy|logged_by|scannedBy|scanned_by|requestedBy|requested_by|submittedBy|submitted_by|referrerUserId|referrer_user_id|directorId|director_id)"[[:space:]]*:[[:space:]]*("'
               || legacy.old_user_id::text || '"|' || legacy.old_user_id::text || ')([,}])'
             )
          OR coalesce(al.after::text, '') ~ (
               '"(userId|user_id|subjectUserId|subject_user_id|actorId|actor_id|targetId|target_id|authorId|author_id|judgeId|judge_id|staffId|staff_id|createdBy|created_by|assignedBy|assigned_by|setBy|set_by|linkedBy|linked_by|loggedBy|logged_by|scannedBy|scanned_by|requestedBy|requested_by|submittedBy|submitted_by|referrerUserId|referrer_user_id|directorId|director_id)"[[:space:]]*:[[:space:]]*("'
               || legacy.old_user_id::text || '"|' || legacy.old_user_id::text || ')([,}])'
             )
          OR coalesce(al.reason, '') ~ (
               '(^|[^0-9])' || legacy.old_user_id::text || '([^0-9]|$)'
             )
          OR (
            legacy.email IS NOT NULL
            AND (
              coalesce(al.before::text, '') ILIKE '%' || legacy.email || '%'
              OR coalesce(al.after::text, '') ILIKE '%' || legacy.email || '%'
              OR coalesce(al.reason, '') ILIKE '%' || legacy.email || '%'
            )
          )
          OR (
            legacy.secondary_email IS NOT NULL
            AND (
              coalesce(al.before::text, '') ILIKE '%' || legacy.secondary_email || '%'
              OR coalesce(al.after::text, '') ILIKE '%' || legacy.secondary_email || '%'
              OR coalesce(al.reason, '') ILIKE '%' || legacy.secondary_email || '%'
            )
          )
          OR (
            legacy.dni IS NOT NULL
            AND (
              coalesce(al.before::text, '') ILIKE '%' || legacy.dni || '%'
              OR coalesce(al.after::text, '') ILIKE '%' || legacy.dni || '%'
              OR coalesce(al.reason, '') ILIKE '%' || legacy.dni || '%'
            )
          )
    );

DELETE FROM users
 WHERE id IN (SELECT old_user_id FROM legacy_anonymized_users);
