-- 0730_account_deletion_anonymization.sql — H54 final schema and main upgrade.
--
-- DELTA(H54): account removal is a transactional lifecycle gate.  Identity
-- rows are either deleted or replaced by an unlinked anonymous audit subject;
-- no mapping table is created.
-- DELTA(H24,H54): raw presence and scanner provenance are operational data and
-- are deleted after guaranteed minutes are calculated.  A pending account can
-- receive only its locked exit time log and bounded recovery sessions until
-- finalization.
-- DELTA(H23,H54): current badge assignment time fences stale offline events.
-- DELTA(H54,F16): retired scanner credentials are keyed, unlinked digests.
--
-- This is the single H54 migration for both a fresh schema and the latest
-- main schema (whose ledger ends at 0725). On an existing database it also
-- converts rows left by the pre-H54 in-place anonymizer before installing the
-- final constraints. The conversion is intentionally one-way and runs in
-- this transaction; no user-to-anonymous mapping survives the migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── users and lifecycle gates ──────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN account_state text NOT NULL DEFAULT 'active'
    CHECK (account_state IN ('active', 'removal_pending')),
  ADD COLUMN removal_action text
    CHECK (removal_action IS NULL OR removal_action IN ('delete', 'anonymize')),
  ADD COLUMN removal_started_at timestamptz,
  ADD COLUMN removal_requires_exit boolean NOT NULL DEFAULT false,
  ADD COLUMN removal_idempotency_key text,
  ADD COLUMN removal_expires_at timestamptz,
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false,
  ADD COLUMN badge_assigned_at timestamptz;

COMMENT ON COLUMN users.account_state IS
  'H54 lifecycle gate: identity-bearing writers are rejected after removal_pending commits.';
COMMENT ON COLUMN users.removal_action IS
  'H54 action selected while the user row is locked; retries cannot change the mode.';
COMMENT ON COLUMN users.removal_requires_exit IS
  'H54 pending-exit gate: only a valid current-badge or event-end exit may be recorded.';
COMMENT ON COLUMN users.removal_idempotency_key IS
  'H54 transient self-service replay key; it is deleted with the user and is not an identity map.';
COMMENT ON COLUMN users.removal_expires_at IS
  'H54 fixed pending-exit recovery deadline; later sign-ins cannot extend it.';
COMMENT ON COLUMN users.is_test_account IS
  'Synthetic reviewer/QA fixture marker; ordinary event surfaces exclude marked rows.';
COMMENT ON COLUMN users.badge_assigned_at IS
  'H23/H54 current physical badge assignment boundary for stale offline scan rejection.';

-- A base row may already have a badge (for example, a deployment seed).  Set
-- its initial boundary before enforcing the badge/timestamp XOR invariant.
UPDATE users
   SET badge_assigned_at = clock_timestamp()
 WHERE badge_id IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_badge_assignment_timestamp_check
  CHECK ((badge_id IS NULL) = (badge_assigned_at IS NULL));

CREATE INDEX users_removal_expiry
  ON users (removal_expires_at)
  WHERE account_state = 'removal_pending' AND removal_expires_at IS NOT NULL;
CREATE INDEX users_test_account_idx
  ON users (id)
  WHERE is_test_account = true;

-- ── final column nullability ────────────────────────────────────────────────

ALTER TABLE check_in_logs
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN staff_id DROP NOT NULL;
ALTER TABLE time_logs
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE queue_history
  ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE universities ALTER COLUMN proposed_by DROP NOT NULL;
ALTER TABLE food_intolerances ALTER COLUMN proposed_by DROP NOT NULL;
ALTER TABLE attempt_review_versions ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE judging_session ALTER COLUMN judge_id DROP NOT NULL;
ALTER TABLE announcements ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE meal_scan_batches
  ALTER COLUMN submitted_by DROP NOT NULL,
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;
ALTER TABLE challenge_winners ALTER COLUMN set_by DROP NOT NULL;
ALTER TABLE room_enterprises ALTER COLUMN assigned_by DROP NOT NULL;
ALTER TABLE room_queue_groups ALTER COLUMN assigned_by DROP NOT NULL;
ALTER TABLE data_subject_requests
  ALTER COLUMN subject_user_id DROP NOT NULL,
  ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE activity_logs ALTER COLUMN logged_by DROP NOT NULL;
ALTER TABLE meal_scan_batch_items ALTER COLUMN badge_id DROP NOT NULL;

COMMENT ON COLUMN meal_scan_batch_items.badge_id IS
  'H54 transient retry credential; NULL after terminal processing and never part of audit history.';

COMMENT ON COLUMN meal_scan_batches.is_test_account IS
  'H54 fixture marker captured at enqueue; remains stable if submitted_by is scrubbed.';

ALTER TABLE time_logs
  ADD CONSTRAINT time_logs_kind_check CHECK (kind IN ('in', 'out'));

-- ── permanent anonymous subject and credential denylist ────────────────────

CREATE TABLE anonymous_participants (
  id uuid PRIMARY KEY,
  guaranteed_presence_minutes integer NOT NULL DEFAULT 0
    CHECK (guaranteed_presence_minutes >= 0),
  is_test_account boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE anonymous_participants IS
  'H54 permanent anonymous audit subject. id is random and unrelated to users.id.';
COMMENT ON COLUMN anonymous_participants.guaranteed_presence_minutes IS
  'H24 verified venue time rounded down to complete minutes; raw presence rows are not retained.';
COMMENT ON COLUMN anonymous_participants.is_test_account IS
  'Synthetic fixture marker; marked anonymous subjects are excluded from normal statistics.';

CREATE INDEX anonymous_participants_test_account_idx
  ON anonymous_participants (id)
  WHERE is_test_account = true;

CREATE TABLE scanner_revoked_badges (
  credential_digest text PRIMARY KEY
    CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE scanner_revoked_tickets (
  credential_digest text PRIMARY KEY
    CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE scanner_revoked_badges IS
  'H54 unlinked keyed-digest denylist for permanently retired badge credentials; raw badges are never retained.';
COMMENT ON TABLE scanner_revoked_tickets IS
  'H54 unlinked keyed-digest denylist for permanently retired ticket credentials; raw tokens are never retained.';
COMMENT ON COLUMN scanner_revoked_badges.credential_digest IS
  'HMAC-SHA256 of a retired badge credential under the deployment secret.';
COMMENT ON COLUMN scanner_revoked_tickets.credential_digest IS
  'HMAC-SHA256 of a retired ticket credential under the deployment secret.';

-- ── transient cleanup/security tables ──────────────────────────────────────

CREATE TABLE user_email_history (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (btrim(email) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, email)
);

COMMENT ON TABLE user_email_history IS
  'H54 transient cleanup aid. It is deleted with the owning user and never copied to anonymous data.';

CREATE INDEX user_email_history_email
  ON user_email_history (lower(email));

-- ── populated latest-main conversion ──────────────────────────────────────

-- `anonymized_at` was the marker used by the old in-place anonymizer. Those
-- rows can still be present when this migration is first deployed from main.
-- Keep the source values only in transaction-local tables while the old user
-- and every identity-bearing relationship are removed. The anonymous subject
-- receives only a conservative aggregate of valid in/out pairs; the old
-- implementation never recorded a trustworthy guaranteed-time value.
CREATE TEMP TABLE legacy_anonymized_users ON COMMIT DROP AS
SELECT id AS old_user_id,
       gen_random_uuid() AS anonymous_id,
       email,
       secondary_email,
       dni,
       array_remove(array_cat(badge_id_history, ARRAY[badge_id]), NULL) AS badge_ids
  FROM users
 WHERE anonymized_at IS NOT NULL;

DO $$
DECLARE
  secret text := current_setting('hackos.better_auth_secret', true);
BEGIN
  IF (
    EXISTS (
      SELECT 1
        FROM legacy_anonymized_users legacy
       CROSS JOIN LATERAL unnest(legacy.badge_ids) AS badges(badge_id)
       WHERE NULLIF(btrim(badges.badge_id), '') IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
        FROM tickets ticket
        JOIN legacy_anonymized_users legacy ON legacy.old_user_id = ticket.user_id
       WHERE NULLIF(btrim(ticket.token), '') IS NOT NULL
    )
  ) AND NULLIF(secret, '') IS NULL THEN
    RAISE EXCEPTION
      'H54 cannot retire legacy scanner credentials without BETTER_AUTH_SECRET; rerun the migration with the deployment secret configured'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

-- A historical badge may have been reassigned after the old account was
-- anonymized. Retiring that value would make the current owner impossible to
-- scan, so abort before writing any denylist rows. The deployment can resolve
-- the collision explicitly and rerun this transaction.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM legacy_anonymized_users legacy
      CROSS JOIN LATERAL unnest(legacy.badge_ids) AS badges(badge_id)
      JOIN users active
        ON active.anonymized_at IS NULL
       AND active.badge_id = btrim(badges.badge_id)
     WHERE NULLIF(btrim(badges.badge_id), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'H54 cannot retire a legacy badge that is currently assigned to an active user; resolve the badge collision and rerun the migration'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

INSERT INTO scanner_revoked_badges (credential_digest, revoked_at)
SELECT DISTINCT
       encode(
         hmac(
           format('hackos:scanner-credential:v1:badge:%s', btrim(badges.badge_id)),
           COALESCE(current_setting('hackos.better_auth_secret', true), ''),
           'sha256'
         ),
         'hex'
       ),
       clock_timestamp()
  FROM legacy_anonymized_users legacy
 CROSS JOIN LATERAL unnest(legacy.badge_ids) AS badges(badge_id)
 WHERE NULLIF(btrim(badges.badge_id), '') IS NOT NULL
ON CONFLICT (credential_digest) DO NOTHING;

INSERT INTO scanner_revoked_tickets (credential_digest, revoked_at)
SELECT DISTINCT
       encode(
         hmac(
           format('hackos:scanner-credential:v1:ticket:%s', btrim(ticket.token)),
           COALESCE(current_setting('hackos.better_auth_secret', true), ''),
           'sha256'
         ),
         'hex'
       ),
       clock_timestamp()
  FROM tickets ticket
  JOIN legacy_anonymized_users legacy ON legacy.old_user_id = ticket.user_id
 WHERE NULLIF(btrim(ticket.token), '') IS NOT NULL
ON CONFLICT (credential_digest) DO NOTHING;

WITH ordered_logs AS (
  SELECT legacy.old_user_id,
         logs.kind,
         logs.scanned_at,
         lead(logs.kind) OVER (
           PARTITION BY logs.user_id ORDER BY logs.scanned_at, logs.id
         ) AS next_kind,
         lead(logs.scanned_at) OVER (
           PARTITION BY logs.user_id ORDER BY logs.scanned_at, logs.id
         ) AS next_scanned_at
    FROM time_logs logs
    JOIN legacy_anonymized_users legacy ON legacy.old_user_id = logs.user_id
   WHERE logs.kind IN ('in', 'out')
), guaranteed_minutes AS (
  SELECT old_user_id,
         sum(
           floor(extract(epoch FROM (next_scanned_at - scanned_at)) / 60)
         )::integer AS minutes
    FROM ordered_logs
   WHERE kind = 'in'
     AND next_kind = 'out'
     AND next_scanned_at > scanned_at
   GROUP BY old_user_id
)
INSERT INTO anonymous_participants (id, guaranteed_presence_minutes)
SELECT legacy.anonymous_id, COALESCE(minutes.minutes, 0)
  FROM legacy_anonymized_users legacy
  LEFT JOIN guaranteed_minutes minutes ON minutes.old_user_id = legacy.old_user_id;

-- Capture project roots before removing old member rows. A solo project and
-- its queue/judging history are subject data; a shared project remains for
-- its other members, without the departing creator.
CREATE TEMP TABLE legacy_subject_repos ON COMMIT DROP AS
SELECT DISTINCT repos.id
  FROM repos
  JOIN legacy_anonymized_users legacy ON legacy.old_user_id = repos.created_by
UNION
SELECT DISTINCT submissions.repo_id
  FROM submissions
  JOIN legacy_anonymized_users legacy ON legacy.old_user_id = submissions.user_id
UNION
SELECT DISTINCT devpost.repo_id
  FROM devpost_participants devpost
  JOIN legacy_anonymized_users legacy ON legacy.old_user_id = devpost.user_id;

-- Presence rows are raw operational data, not permanent anonymous audit data.
-- The aggregate above is the only attendance evidence carried forward.
DELETE FROM check_in_logs
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM time_logs
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);

-- Remove old identities from actor/provenance columns. Subject rows are
-- deleted below; actor columns are nullable in the final H54 schema.
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
UPDATE submissions SET invited_by = NULL
 WHERE invited_by IN (SELECT old_user_id FROM legacy_anonymized_users);
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
UPDATE application_responses SET referrer_application_id = NULL
 WHERE referrer_application_id IN (
   SELECT id FROM application_responses
    WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
 );
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
UPDATE schedule_owners SET assigned_by = NULL
 WHERE assigned_by IN (SELECT old_user_id FROM legacy_anonymized_users);

-- Delete identity-bearing subject rows and their dependent resources.
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
UPDATE repos SET created_by = NULL
 WHERE created_by IN (SELECT old_user_id FROM legacy_anonymized_users);

CREATE TEMP TABLE legacy_orphan_repos ON COMMIT DROP AS
SELECT subject.id
  FROM legacy_subject_repos subject
 WHERE NOT EXISTS (
   SELECT 1 FROM submissions submissions WHERE submissions.repo_id = subject.id
 );
CREATE TEMP TABLE legacy_orphan_queue_entries ON COMMIT DROP AS
SELECT entries.id
  FROM queue_entries entries
  JOIN legacy_orphan_repos orphan ON orphan.id = entries.repo_id;
DELETE FROM attempt_review_versions versions
 USING legacy_orphan_queue_entries orphan
 WHERE versions.attempt_id = orphan.id;
DELETE FROM attempt_review reviews
 USING legacy_orphan_queue_entries orphan
 WHERE reviews.attempt_id = orphan.id;
DELETE FROM judging_session sessions
 USING legacy_orphan_queue_entries orphan
 WHERE sessions.queue_entry_id = orphan.id;
DELETE FROM queue_history history
 USING legacy_orphan_queue_entries orphan
 WHERE history.queue_entry_id = orphan.id;
DELETE FROM queue_entries entries
 USING legacy_orphan_queue_entries orphan
 WHERE entries.id = orphan.id;
DELETE FROM challenge_winners
 WHERE repo_id IN (SELECT id FROM legacy_orphan_repos);
DELETE FROM repo_devpost_prizes
 WHERE repo_id IN (SELECT id FROM legacy_orphan_repos);
DELETE FROM devpost_participants
 WHERE repo_id IN (SELECT id FROM legacy_orphan_repos);
DELETE FROM submissions
 WHERE repo_id IN (SELECT id FROM legacy_orphan_repos);
DELETE FROM repos
 WHERE id IN (SELECT id FROM legacy_orphan_repos);

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
DELETE FROM email_verification_tokens
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
    OR lower(email) IN (
      SELECT lower(email) FROM legacy_anonymized_users WHERE email IS NOT NULL
      UNION
      SELECT lower(secondary_email) FROM legacy_anonymized_users WHERE secondary_email IS NOT NULL
    );
DELETE FROM activity_logs
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM meal_scan_batch_items item
 USING legacy_anonymized_users legacy
 WHERE item.badge_id = ANY(legacy.badge_ids)
    OR coalesce(item.result::text, '') ILIKE '%"userId":' || legacy.old_user_id::text || '%'
    OR coalesce(item.error::text, '') ILIKE '%"userId":' || legacy.old_user_id::text || '%'
    OR (
      legacy.email IS NOT NULL
      AND (
        coalesce(item.result::text, '') ILIKE '%' || legacy.email || '%'
        OR coalesce(item.error::text, '') ILIKE '%' || legacy.email || '%'
      )
    )
    OR (
      legacy.secondary_email IS NOT NULL
      AND (
        coalesce(item.result::text, '') ILIKE '%' || legacy.secondary_email || '%'
        OR coalesce(item.error::text, '') ILIKE '%' || legacy.secondary_email || '%'
      )
    );
DELETE FROM enterprise_judges
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM permission_group_members
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM schedule_owners
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
UPDATE sponsors sponsors
   SET user_id = NULL
 WHERE sponsors.user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
   AND EXISTS (SELECT 1 FROM challenges challenges WHERE challenges.author = sponsors.id);
DELETE FROM sponsors
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
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
DELETE FROM wallet_access_tokens
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM push_tokens
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM sessions
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM accounts
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM email_verification_tokens
 WHERE user_id IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM verifications
 WHERE NOT EXISTS (
         SELECT 1
           FROM users active
          WHERE active.anonymized_at IS NULL
            AND (
              lower(active.email) = lower(verifications.identifier)
              OR (
                active.secondary_email IS NOT NULL
                AND lower(active.secondary_email) = lower(verifications.identifier)
              )
              OR active.id::text = verifications.identifier
            )
       );
DELETE FROM data_subject_requests
 WHERE subject_user_id IN (SELECT old_user_id FROM legacy_anonymized_users)
    OR requested_by IN (SELECT old_user_id FROM legacy_anonymized_users);
DELETE FROM idempotency_keys keys
 USING legacy_anonymized_users legacy
 WHERE keys.scope ~ ('(^| )u:' || legacy.old_user_id::text || '($| )')
    OR (
      legacy.email IS NOT NULL
      AND coalesce(keys.response_body::text, '') ILIKE '%' || legacy.email || '%'
    )
    OR (
      legacy.secondary_email IS NOT NULL
      AND coalesce(keys.response_body::text, '') ILIKE '%' || legacy.secondary_email || '%'
    );
DELETE FROM audit_log audit
 WHERE audit.actor_id IN (SELECT old_user_id FROM legacy_anonymized_users)
    OR (
      audit.entity_type = ANY(ARRAY['user', 'badge', 'accreditation', 'presence', 'meal', 'activity'])
      AND audit.entity_id IN (SELECT old_user_id::text FROM legacy_anonymized_users)
    )
    OR EXISTS (
      SELECT 1
        FROM legacy_anonymized_users legacy
       WHERE coalesce(audit.before::text, '') ~ (
               '"(userId|user_id|subjectUserId|subject_user_id|actorId|actor_id|targetId|target_id|authorId|author_id|judgeId|judge_id|staffId|staff_id|createdBy|created_by|assignedBy|assigned_by|setBy|set_by|linkedBy|linked_by|loggedBy|logged_by|scannedBy|scanned_by|requestedBy|requested_by|submittedBy|submitted_by|referrerUserId|referrer_user_id|directorId|director_id)"[[:space:]]*:[[:space:]]*("'
               || legacy.old_user_id::text || '"|' || legacy.old_user_id::text || ')([,}])'
             )
          OR coalesce(audit.after::text, '') ~ (
               '"(userId|user_id|subjectUserId|subject_user_id|actorId|actor_id|targetId|target_id|authorId|author_id|judgeId|judge_id|staffId|staff_id|createdBy|created_by|assignedBy|assigned_by|setBy|set_by|linkedBy|linked_by|loggedBy|logged_by|scannedBy|scanned_by|requestedBy|requested_by|submittedBy|submitted_by|referrerUserId|referrer_user_id|directorId|director_id)"[[:space:]]*:[[:space:]]*("'
               || legacy.old_user_id::text || '"|' || legacy.old_user_id::text || ')([,}])'
             )
          OR coalesce(audit.reason, '') ~ (
               '(^|[^0-9])' || legacy.old_user_id::text || '([^0-9]|$)'
             )
          OR (
            legacy.email IS NOT NULL
            AND (
              coalesce(audit.before::text, '') ILIKE '%' || legacy.email || '%'
              OR coalesce(audit.after::text, '') ILIKE '%' || legacy.email || '%'
              OR coalesce(audit.reason, '') ILIKE '%' || legacy.email || '%'
              OR coalesce(audit.entity_id, '') ILIKE '%' || legacy.email || '%'
            )
          )
          OR (
            legacy.secondary_email IS NOT NULL
            AND (
              coalesce(audit.before::text, '') ILIKE '%' || legacy.secondary_email || '%'
              OR coalesce(audit.after::text, '') ILIKE '%' || legacy.secondary_email || '%'
              OR coalesce(audit.reason, '') ILIKE '%' || legacy.secondary_email || '%'
              OR coalesce(audit.entity_id, '') ILIKE '%' || legacy.secondary_email || '%'
            )
          )
          OR (
            legacy.dni IS NOT NULL
            AND (
              coalesce(audit.before::text, '') ILIKE '%' || legacy.dni || '%'
              OR coalesce(audit.after::text, '') ILIKE '%' || legacy.dni || '%'
              OR coalesce(audit.reason, '') ILIKE '%' || legacy.dni || '%'
              OR coalesce(audit.entity_id, '') ILIKE '%' || legacy.dni || '%'
            )
          )
    );

-- Any omitted non-null user reference is a migration error, not something to
-- silently leave behind. Nullable actor references are cleared above; this
-- check protects the populated upgrade as new main tables are added.
DO $$
DECLARE
  fk record;
  remaining bigint;
BEGIN
  FOR fk IN
    SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY key_column(attnum, ord)
        ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key_column.attnum
     WHERE con.contype = 'f'
       AND parent.relname = 'users'
       AND n.nspname = 'public'
       AND key_column.ord = 1
       AND c.relname <> 'users'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE %I = ANY ($1::integer[])',
      fk.table_name,
      fk.column_name
    ) INTO remaining USING ARRAY(SELECT old_user_id FROM legacy_anonymized_users);
    IF remaining > 0 THEN
      RAISE EXCEPTION
        'H54 legacy conversion left % rows referencing removed users in %.%',
        remaining, fk.table_name, fk.column_name;
    END IF;
  END LOOP;
END;
$$;

DELETE FROM users
 WHERE id IN (SELECT old_user_id FROM legacy_anonymized_users);

CREATE TABLE account_removal_pin_challenges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  pin_digest text NOT NULL,
  nonce text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX account_removal_pin_challenges_user
  ON account_removal_pin_challenges (user_id, created_at DESC);

COMMENT ON TABLE account_removal_pin_challenges IS
  'H54 transient one-time verified-email removal PIN state; deleted with the user.';
COMMENT ON COLUMN account_removal_pin_challenges.pin_digest IS
  'HMAC digest of the six-digit PIN, user id, email, and nonce; raw PINs are never persisted.';

-- ── immutable application form snapshots ───────────────────────────────────

ALTER TABLE applications
  ADD COLUMN current_form_version integer NOT NULL DEFAULT 1
    CHECK (current_form_version > 0);

CREATE TABLE application_form_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  template jsonb NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (application_id, version),
  UNIQUE (application_id, id)
);

COMMENT ON TABLE application_form_versions IS
  'H54 immutable form-definition snapshots; response retention uses the submitted snapshot.';
COMMENT ON COLUMN application_form_versions.created_by IS
  'Administrator who published the snapshot; nullable so removing that actor leaves no identity bridge.';

INSERT INTO application_form_versions (application_id, version, template, sections)
SELECT id, current_form_version, template, sections
  FROM applications;

ALTER TABLE application_responses
  ADD COLUMN application_form_version_id bigint
    REFERENCES application_form_versions(id) ON DELETE RESTRICT;

-- Applications created before this baseline use version 1.  This only binds
-- the immutable snapshot pointer; it never copies response data.
UPDATE application_responses AS response
   SET application_form_version_id = version.id
  FROM application_form_versions AS version
 WHERE response.application_form_version_id IS NULL
   AND version.application_id = response.application_id
   AND version.version = 1;

ALTER TABLE application_responses
  ALTER COLUMN application_form_version_id SET NOT NULL,
  ADD CONSTRAINT application_responses_form_version_application_fk
    FOREIGN KEY (application_id, application_form_version_id)
    REFERENCES application_form_versions (application_id, id)
    ON DELETE RESTRICT;

CREATE INDEX application_responses_form_version
  ON application_responses (application_form_version_id);

CREATE TABLE anonymous_participant_fields (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anonymous_participant_id uuid NOT NULL
    REFERENCES anonymous_participants(id) ON DELETE CASCADE,
  application_id integer REFERENCES applications(id) ON DELETE RESTRICT,
  application_form_version integer
    CHECK (application_form_version IS NULL OR application_form_version > 0),
  field_key text NOT NULL CHECK (btrim(field_key) <> ''),
  anonymous_audit_dimension text,
  field_kind text NOT NULL CHECK (btrim(field_kind) <> ''),
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX anonymous_participant_fields_subject
  ON anonymous_participant_fields (anonymous_participant_id);
CREATE INDEX anonymous_participant_fields_dimension
  ON anonymous_participant_fields (anonymous_audit_dimension)
  WHERE anonymous_audit_dimension IS NOT NULL;
CREATE INDEX anonymous_participant_fields_form
  ON anonymous_participant_fields (application_id, application_form_version, field_key);

COMMENT ON TABLE anonymous_participant_fields IS
  'H54 permanent anonymous answers explicitly marked ANONYMOUS_AUDIT in the submitted form snapshot.';
COMMENT ON COLUMN anonymous_participant_fields.application_id IS
  'Form context only; it is not application_responses.id and does not identify the participant.';
COMMENT ON COLUMN anonymous_participant_fields.value IS
  'Sanitized typed value copied only when the submitted field definition opts into anonymous audit.';

-- ── synthetic reviewer fixture graph ───────────────────────────────────────

ALTER TABLE repos
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;
ALTER TABLE challenges
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN repos.is_test_account IS
  'Synthetic review-fixture project marker; ordinary event operations exclude marked rows.';
COMMENT ON COLUMN challenges.is_test_account IS
  'Synthetic review-fixture queue marker; ordinary event operations exclude marked rows.';

CREATE INDEX repos_test_account_idx
  ON repos (id)
  WHERE is_test_account = true;
CREATE INDEX challenges_test_account_idx
  ON challenges (id)
  WHERE is_test_account = true;

CREATE TABLE review_fixture_accounts (
  fixture_key text PRIMARY KEY CHECK (btrim(fixture_key) <> ''),
  user_id integer UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  last_authenticated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER review_fixture_accounts_updated_at
  BEFORE UPDATE ON review_fixture_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE review_fixture_accounts IS
  'Current synthetic reviewer account pointers; never use as an anonymous identity mapping.';
COMMENT ON COLUMN review_fixture_accounts.last_authenticated_at IS
  'Last synthetic fixture sign-in signal; no credential or participant response is stored.';

INSERT INTO review_fixture_accounts (fixture_key)
VALUES
  ('participant-delete'),
  ('participant-anonymize-outside'),
  ('participant-anonymize-inside'),
  ('staff-exit-operator')
ON CONFLICT (fixture_key) DO NOTHING;

CREATE TABLE review_fixture_queues (
  fixture_key text PRIMARY KEY
    REFERENCES review_fixture_accounts(fixture_key) ON DELETE CASCADE,
  enterprise_id integer UNIQUE REFERENCES enterprises(id) ON DELETE SET NULL,
  sponsor_id integer UNIQUE REFERENCES sponsors(id) ON DELETE SET NULL,
  challenge_id integer UNIQUE REFERENCES challenges(id) ON DELETE SET NULL,
  repo_id integer UNIQUE REFERENCES repos(id) ON DELETE SET NULL,
  queue_entry_id integer UNIQUE REFERENCES queue_entries(id) ON DELETE SET NULL,
  generation integer NOT NULL CHECK (generation > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER review_fixture_queues_updated_at
  BEFORE UPDATE ON review_fixture_queues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE review_fixture_queues IS
  'Current synthetic queue/project pointers; never use as a participant-to-anonymous mapping.';

-- ── immutable/form and badge functions ─────────────────────────────────────

CREATE OR REPLACE FUNCTION h54_prevent_form_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'application form versions are immutable'
    USING ERRCODE = '55006';
END;
$$;

CREATE TRIGGER h54_application_form_version_immutable
  BEFORE UPDATE ON application_form_versions
  FOR EACH ROW EXECUTE FUNCTION h54_prevent_form_version_update();

CREATE OR REPLACE FUNCTION h54_capture_user_email_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  address text;
BEGIN
  FOREACH address IN ARRAY ARRAY[OLD.email, OLD.secondary_email, NEW.email, NEW.secondary_email]
  LOOP
    IF NULLIF(btrim(address), '') IS NOT NULL THEN
      INSERT INTO user_email_history (user_id, email)
      VALUES (NEW.id, lower(btrim(address)))
      ON CONFLICT (user_id, email) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER h54_user_email_history
  AFTER UPDATE OF email, secondary_email ON users
  FOR EACH ROW EXECUTE FUNCTION h54_capture_user_email_history();

CREATE OR REPLACE FUNCTION h54_set_badge_assigned_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.badge_id IS NULL THEN
    NEW.badge_assigned_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.badge_assigned_at := clock_timestamp();
  ELSIF NEW.badge_id IS DISTINCT FROM OLD.badge_id THEN
    NEW.badge_assigned_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_badge_assigned_at
  BEFORE INSERT OR UPDATE OF badge_id ON users
  FOR EACH ROW EXECUTE FUNCTION h54_set_badge_assigned_at();

-- ── active-user reference gate ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION h54_require_active_user_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_user_id bigint;
  old_referenced_user_id bigint;
  cutoff timestamptz;
  removal_started_at_value timestamptz;
  latest_id bigint;
  latest_kind text;
BEGIN
  referenced_user_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::bigint;
  -- Detaching an identity is always safe.  In particular, ON DELETE SET NULL
  -- and the removal scrub deliberately clear references while the old user is
  -- already `removal_pending`; do not make that cleanup depend on the old row
  -- still passing the active-account gate.
  IF referenced_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_referenced_user_id := NULLIF(to_jsonb(OLD)->>TG_ARGV[0], '')::bigint;
    -- Never transfer a row from a pending identity to another identity.  A
    -- NULL destination is allowed for the removal scrub below.
    IF old_referenced_user_id IS NOT NULL
       AND old_referenced_user_id IS DISTINCT FROM referenced_user_id THEN
      PERFORM 1
        FROM users
       WHERE id = old_referenced_user_id
         AND account_state = 'active'
         AND anonymized_at IS NULL
       FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'user account is closed or being removed'
          USING ERRCODE = '23514',
                HINT = 'Retry after reloading the current account state';
      END IF;
    END IF;
  END IF;

  -- The only identity-bearing write permitted after removal starts is the
  -- exit row for the already-open venue session.  It must retain the same
  -- user_id on UPDATE and is serialized by the user-row lock.
  IF TG_TABLE_NAME = 'time_logs'
     AND TG_ARGV[0] = 'user_id'
     AND to_jsonb(NEW)->>'kind' = 'out'
     AND (TG_OP <> 'UPDATE' OR old_referenced_user_id IS NOT DISTINCT FROM referenced_user_id) THEN
    cutoff := NULLIF(to_jsonb(NEW)->>'scanned_at', '')::timestamptz;
    SELECT id, kind
      INTO latest_id, latest_kind
      FROM time_logs
     WHERE user_id = referenced_user_id
       AND kind IN ('in', 'out')
       AND scanned_at <= cutoff
     ORDER BY scanned_at DESC, id DESC
     LIMIT 1;
    SELECT removal_started_at
      INTO removal_started_at_value
      FROM users
     WHERE id = referenced_user_id
       AND account_state = 'removal_pending'
       AND removal_requires_exit = true
       AND anonymized_at IS NULL
     FOR SHARE;
    IF FOUND
       AND latest_kind = 'in'
       AND (TG_OP <> 'UPDATE' OR latest_id = NULLIF(to_jsonb(NEW)->>'id', '')::bigint)
       AND removal_started_at_value IS NOT NULL
       AND (
         cutoff >= removal_started_at_value
         OR (
           TG_OP = 'INSERT'
           AND to_jsonb(NEW)->>'scanned_by' IS NULL
           AND to_jsonb(NEW)->>'notes' = 'Automatic exit at event end'
           AND EXISTS (
             SELECT 1
               FROM event_config
              WHERE id = 1
                AND event_ends_at = cutoff
                AND event_ends_at <= clock_timestamp()
           )
         )
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Recovery sign-in and session refresh remain available during a reversible
  -- exit, but a session must never outlive the already-captured deadline.
  IF TG_TABLE_NAME = 'sessions'
     AND TG_ARGV[0] = 'user_id'
     AND (TG_OP <> 'UPDATE' OR old_referenced_user_id IS NOT DISTINCT FROM referenced_user_id)
     AND NULLIF(to_jsonb(NEW)->>'expires_at', '')::timestamptz <= (
       SELECT removal_expires_at
         FROM users
        WHERE id = referenced_user_id
          AND account_state = 'removal_pending'
          AND removal_action = 'anonymize'
          AND removal_requires_exit = true
          AND anonymized_at IS NULL
          AND removal_expires_at IS NOT NULL
          AND removal_expires_at > clock_timestamp()
        FOR SHARE
     ) THEN
    RETURN NEW;
  END IF;

  PERFORM 1
    FROM users
   WHERE id = referenced_user_id
     AND account_state = 'active'
     AND anonymized_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user account is closed or being removed'
      USING ERRCODE = '23514',
            HINT = 'Retry after reloading the current account state';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION h54_require_active_user_reference() IS
  'H54: reject identity-bearing rows for pending/anonymized users; permit only the locked pending exit time log and bounded recovery sessions.';

-- Every final FK to users receives a full-row trigger.  The user_id time-log
-- trigger is specialized above; scanned_by still receives the ordinary gate.
DO $$
DECLARE
  fk record;
  trigger_name text;
BEGIN
  FOR fk IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           a.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY key_column(attnum, ord)
        ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key_column.attnum
     WHERE con.contype = 'f'
       AND parent.relname = 'users'
       AND n.nspname = 'public'
       AND key_column.ord = 1
       AND NOT (c.relname = 'time_logs' AND a.attname = 'user_id')
  LOOP
    trigger_name := format('h54_active_user_%s', fk.column_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      trigger_name, fk.schema_name, fk.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I.%I '
      'FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference(%L)',
      trigger_name, fk.schema_name, fk.table_name, fk.column_name
    );
  END LOOP;

  DROP TRIGGER IF EXISTS h54_active_user_user_id ON time_logs;
  CREATE TRIGGER h54_active_user_user_id
    BEFORE INSERT OR UPDATE ON time_logs
    FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('user_id');
END;
$$;
