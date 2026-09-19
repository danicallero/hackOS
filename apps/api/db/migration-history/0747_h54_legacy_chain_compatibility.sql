-- 0747_h54_legacy_chain_compatibility.sql — normalize the pre-squash H54 history.
--
-- DELTA(H54): databases that recorded the development-only 0731–0746 chain,
-- or an earlier 0730 baseline, are upgraded in place.  The migration runner
-- invokes this file only for that explicitly allow-listed history; a fresh
-- database uses the squashed 0730 and does not record a no-op compatibility
-- row.  Everything runs in this transaction, so a failed conversion leaves
-- the old schema and ledger untouched.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── users and final nullability ────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_state text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS removal_action text,
  ADD COLUMN IF NOT EXISTS removal_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS removal_requires_exit boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS removal_idempotency_key text,
  ADD COLUMN IF NOT EXISTS removal_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_test_account boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_assigned_at timestamptz;

UPDATE users SET account_state = 'active' WHERE account_state IS NULL;
UPDATE users SET removal_requires_exit = false WHERE removal_requires_exit IS NULL;
UPDATE users SET is_test_account = false WHERE is_test_account IS NULL;
UPDATE users
   SET removal_started_at = COALESCE(removal_started_at, updated_at, clock_timestamp())
 WHERE account_state = 'removal_pending'
   AND removal_started_at IS NULL;
UPDATE users
   SET badge_assigned_at = clock_timestamp()
 WHERE badge_id IS NOT NULL
   AND badge_assigned_at IS NULL;

ALTER TABLE users
  ALTER COLUMN account_state SET DEFAULT 'active',
  ALTER COLUMN account_state SET NOT NULL,
  ALTER COLUMN removal_requires_exit SET DEFAULT false,
  ALTER COLUMN removal_requires_exit SET NOT NULL,
  ALTER COLUMN is_test_account SET DEFAULT false,
  ALTER COLUMN is_test_account SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass
       AND conname = 'users_account_state_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_account_state_check
      CHECK (account_state IN ('active', 'removal_pending'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass
       AND conname = 'users_removal_action_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_removal_action_check
      CHECK (removal_action IS NULL OR removal_action IN ('delete', 'anonymize'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass
       AND conname = 'users_badge_assignment_timestamp_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_badge_assignment_timestamp_check
      CHECK ((badge_id IS NULL) = (badge_assigned_at IS NULL));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS users_removal_expiry
  ON users (removal_expires_at)
  WHERE account_state = 'removal_pending' AND removal_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_test_account_idx
  ON users (id)
  WHERE is_test_account = true;

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
ALTER TABLE meal_scan_batches ALTER COLUMN submitted_by DROP NOT NULL;
ALTER TABLE challenge_winners ALTER COLUMN set_by DROP NOT NULL;
ALTER TABLE room_enterprises ALTER COLUMN assigned_by DROP NOT NULL;
ALTER TABLE room_queue_groups ALTER COLUMN assigned_by DROP NOT NULL;
ALTER TABLE data_subject_requests
  ALTER COLUMN subject_user_id DROP NOT NULL,
  ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE activity_logs ALTER COLUMN logged_by DROP NOT NULL;
ALTER TABLE meal_scan_batch_items ALTER COLUMN badge_id DROP NOT NULL;
ALTER TABLE meal_scan_batches
  ADD COLUMN IF NOT EXISTS is_test_account boolean DEFAULT false;
UPDATE meal_scan_batches SET is_test_account = false WHERE is_test_account IS NULL;
ALTER TABLE meal_scan_batches
  ALTER COLUMN is_test_account SET DEFAULT false,
  ALTER COLUMN is_test_account SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.time_logs'::regclass
       AND conname = 'time_logs_kind_check'
  ) THEN
    ALTER TABLE time_logs
      ADD CONSTRAINT time_logs_kind_check CHECK (kind IN ('in', 'out'));
  END IF;
END;
$$;

-- ── old anonymous foreign keys and fixed fields ────────────────────────────

-- The first H54 migration temporarily attached raw presence rows to an
-- anonymous UUID and kept six fixed demographic columns.  Preserve those
-- values in the current dynamic table, then remove the operational rows and
-- the obsolete columns.  Dynamic SQL is used because the columns are absent
-- from later points in the old chain.

CREATE TABLE IF NOT EXISTS anonymous_participants (
  id uuid PRIMARY KEY,
  guaranteed_presence_minutes integer NOT NULL DEFAULT 0
    CHECK (guaranteed_presence_minutes >= 0),
  is_test_account boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE anonymous_participants
  ADD COLUMN IF NOT EXISTS guaranteed_presence_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_test_account boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT clock_timestamp();
UPDATE anonymous_participants
   SET guaranteed_presence_minutes = 0
 WHERE guaranteed_presence_minutes IS NULL;
UPDATE anonymous_participants SET is_test_account = false WHERE is_test_account IS NULL;
UPDATE anonymous_participants SET created_at = clock_timestamp() WHERE created_at IS NULL;
ALTER TABLE anonymous_participants
  ALTER COLUMN guaranteed_presence_minutes SET DEFAULT 0,
  ALTER COLUMN guaranteed_presence_minutes SET NOT NULL,
  ALTER COLUMN is_test_account SET DEFAULT false,
  ALTER COLUMN is_test_account SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.anonymous_participants'::regclass
       AND conname = 'anonymous_participants_guaranteed_presence_minutes_check'
  ) THEN
    ALTER TABLE anonymous_participants
      ADD CONSTRAINT anonymous_participants_guaranteed_presence_minutes_check
      CHECK (guaranteed_presence_minutes >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS anonymous_participants_test_account_idx
  ON anonymous_participants (id)
  WHERE is_test_account = true;

CREATE TABLE IF NOT EXISTS anonymous_participant_fields (
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

ALTER TABLE anonymous_participant_fields
  ADD COLUMN IF NOT EXISTS application_id integer,
  ADD COLUMN IF NOT EXISTS application_form_version integer,
  ADD COLUMN IF NOT EXISTS anonymous_audit_dimension text;
CREATE INDEX IF NOT EXISTS anonymous_participant_fields_subject
  ON anonymous_participant_fields (anonymous_participant_id);
CREATE INDEX IF NOT EXISTS anonymous_participant_fields_dimension
  ON anonymous_participant_fields (anonymous_audit_dimension)
  WHERE anonymous_audit_dimension IS NOT NULL;
CREATE INDEX IF NOT EXISTS anonymous_participant_fields_form
  ON anonymous_participant_fields (application_id, application_form_version, field_key);

DO $$
DECLARE
  legacy_field record;
BEGIN
  FOR legacy_field IN
    SELECT * FROM (VALUES
      ('age', 'age', 'number'),
      ('gender', 'gender', 'text'),
      ('university', 'university', 'text'),
      ('degree', 'degree', 'text'),
      ('graduation_year', 'graduation_year', 'number'),
      ('origin_city', 'origin_city', 'text')
    ) AS fields(column_name, field_key, field_kind)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.anonymous_participants'::regclass
         AND attname = legacy_field.column_name
         AND NOT attisdropped
    ) THEN
      EXECUTE format(
        'INSERT INTO anonymous_participant_fields
           (anonymous_participant_id, field_key, anonymous_audit_dimension, field_kind, value)
         SELECT p.id, %L, %L, %L, to_jsonb(p.%I)
           FROM anonymous_participants p
          WHERE p.%I IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM anonymous_participant_fields f
               WHERE f.anonymous_participant_id = p.id
                 AND f.field_key = %L
            )',
        legacy_field.field_key,
        legacy_field.field_key,
        legacy_field.field_kind,
        legacy_field.column_name,
        legacy_field.column_name,
        legacy_field.field_key
      );
    END IF;
  END LOOP;
END;
$$;

DROP INDEX IF EXISTS check_in_logs_anonymous_participant;
DROP INDEX IF EXISTS time_logs_anonymous_participant;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.check_in_logs'::regclass
       AND attname = 'anonymous_participant_id'
       AND NOT attisdropped
  ) THEN
    EXECUTE 'DELETE FROM check_in_logs WHERE anonymous_participant_id IS NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.time_logs'::regclass
       AND attname = 'anonymous_participant_id'
       AND NOT attisdropped
  ) THEN
    EXECUTE 'DELETE FROM time_logs WHERE anonymous_participant_id IS NOT NULL';
  END IF;
END;
$$;
ALTER TABLE check_in_logs
  DROP COLUMN IF EXISTS anonymous_participant_id;
ALTER TABLE time_logs
  DROP COLUMN IF EXISTS anonymous_participant_id;
ALTER TABLE anonymous_participants
  DROP COLUMN IF EXISTS age,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS university,
  DROP COLUMN IF EXISTS degree,
  DROP COLUMN IF EXISTS graduation_year,
  DROP COLUMN IF EXISTS origin_city;

-- ── scanner credential normalization ──────────────────────────────────────

-- Raw values can only be converted while the deployment secret is available.
-- A populated database never proceeds by relabelling raw text as a digest.

DO $$
DECLARE
  secret text := current_setting('hackos.better_auth_secret', true);
  has_raw boolean;
  has_digest boolean;
  has_expiry boolean;
  conflict_found boolean;
  malformed_found boolean;
BEGIN
  IF to_regclass('public.scanner_revoked_badges') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE scanner_revoked_badges (
        credential_digest text PRIMARY KEY
          CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
        revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    $sql$;
  ELSE
    SELECT EXISTS (
             SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.scanner_revoked_badges'::regclass
                AND attname = 'badge_id' AND NOT attisdropped
           ),
           EXISTS (
             SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.scanner_revoked_badges'::regclass
                AND attname = 'credential_digest' AND NOT attisdropped
           ),
           EXISTS (
             SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.scanner_revoked_badges'::regclass
                AND attname = 'expires_at' AND NOT attisdropped
           )
      INTO has_raw, has_digest, has_expiry;

    IF has_raw AND has_digest THEN
      RAISE EXCEPTION 'H54 scanner badge table has both raw and digest columns; repair it before retrying'
        USING ERRCODE = '55006';
    ELSIF has_raw THEN
      IF NULLIF(secret, '') IS NULL THEN
        RAISE EXCEPTION
          'H54 cannot key legacy badge tombstones without BETTER_AUTH_SECRET; rerun with the deployment secret'
          USING ERRCODE = '22023';
      END IF;
      EXECUTE 'SELECT EXISTS (
                 SELECT 1
                   FROM scanner_revoked_badges revoked
                   JOIN users active
                     ON active.account_state = ''active''
                    AND active.anonymized_at IS NULL
                    AND (active.badge_id = btrim(revoked.badge_id)
                         OR btrim(revoked.badge_id) = ANY(active.badge_id_history))
                  WHERE NULLIF(btrim(revoked.badge_id), '''') IS NOT NULL
               )' INTO conflict_found;
      IF conflict_found THEN
        RAISE EXCEPTION
          'H54 cannot retire a legacy badge that is assigned to an active user; resolve the collision and retry'
          USING ERRCODE = '23514';
      END IF;
      EXECUTE 'SELECT EXISTS (
                 SELECT 1 FROM scanner_revoked_badges
                  WHERE NULLIF(btrim(badge_id), '''') IS NULL
               )' INTO malformed_found;
      IF malformed_found THEN
        RAISE EXCEPTION 'H54 legacy badge tombstones contain an empty credential'
          USING ERRCODE = '23514';
      END IF;
      EXECUTE 'CREATE TEMP TABLE h54_legacy_badges ON COMMIT DROP AS
               SELECT btrim(badge_id) AS credential, min(revoked_at) AS revoked_at
                 FROM scanner_revoked_badges
                GROUP BY btrim(badge_id)';
      EXECUTE 'DROP TABLE scanner_revoked_badges';
      EXECUTE $sql$
        CREATE TABLE scanner_revoked_badges (
          credential_digest text PRIMARY KEY
            CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
          revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )
      $sql$;
      EXECUTE format(
        'INSERT INTO scanner_revoked_badges (credential_digest, revoked_at)
         SELECT encode(hmac(format(''hackos:scanner-credential:v1:badge:%%s'', credential), %L, ''sha256''), ''hex''),
                revoked_at
           FROM h54_legacy_badges',
        secret
      );
      has_expiry := false;
      has_digest := true;
    ELSIF NOT has_digest THEN
      RAISE EXCEPTION 'H54 scanner badge table has no recognized credential column; repair it before retrying'
        USING ERRCODE = '55006';
    END IF;

    IF has_expiry THEN
      EXECUTE 'ALTER TABLE scanner_revoked_badges ALTER COLUMN expires_at DROP NOT NULL';
      EXECUTE 'UPDATE scanner_revoked_badges SET expires_at = NULL WHERE expires_at IS NOT NULL';
      EXECUTE 'ALTER TABLE scanner_revoked_badges DROP COLUMN expires_at';
    END IF;
  END IF;

  EXECUTE 'UPDATE scanner_revoked_badges SET revoked_at = clock_timestamp() WHERE revoked_at IS NULL';
  EXECUTE 'ALTER TABLE scanner_revoked_badges ALTER COLUMN revoked_at SET DEFAULT clock_timestamp()';
  EXECUTE 'ALTER TABLE scanner_revoked_badges ALTER COLUMN revoked_at SET NOT NULL';
  EXECUTE 'SELECT EXISTS (
             SELECT 1 FROM scanner_revoked_badges
              WHERE credential_digest !~ ''^[0-9a-f]{64}$''
           )' INTO malformed_found;
  IF malformed_found THEN
    RAISE EXCEPTION 'H54 scanner badge denylist contains a malformed digest'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.scanner_revoked_badges'::regclass
       AND contype = 'p'
  ) THEN
    EXECUTE 'ALTER TABLE scanner_revoked_badges ADD PRIMARY KEY (credential_digest)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.scanner_revoked_badges'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%credential_digest%64%'
  ) THEN
    EXECUTE 'ALTER TABLE scanner_revoked_badges ADD CONSTRAINT scanner_revoked_badges_credential_digest_check CHECK (credential_digest ~ ''^[0-9a-f]{64}$'')';
  END IF;
END;
$$;

DO $$
DECLARE
  secret text := current_setting('hackos.better_auth_secret', true);
  has_raw boolean;
  has_digest boolean;
  has_expiry boolean;
  conflict_found boolean;
  malformed_found boolean;
BEGIN
  IF to_regclass('public.scanner_revoked_tickets') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE scanner_revoked_tickets (
        credential_digest text PRIMARY KEY
          CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
        revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    $sql$;
  ELSE
    SELECT EXISTS (
             SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.scanner_revoked_tickets'::regclass
                AND attname = 'ticket_token' AND NOT attisdropped
           ),
           EXISTS (
             SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.scanner_revoked_tickets'::regclass
                AND attname = 'credential_digest' AND NOT attisdropped
           ),
           EXISTS (
             SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.scanner_revoked_tickets'::regclass
                AND attname = 'expires_at' AND NOT attisdropped
           )
      INTO has_raw, has_digest, has_expiry;

    IF has_raw AND has_digest THEN
      RAISE EXCEPTION 'H54 scanner ticket table has both raw and digest columns; repair it before retrying'
        USING ERRCODE = '55006';
    ELSIF has_raw THEN
      IF NULLIF(secret, '') IS NULL THEN
        RAISE EXCEPTION
          'H54 cannot key legacy ticket tombstones without BETTER_AUTH_SECRET; rerun with the deployment secret'
          USING ERRCODE = '22023';
      END IF;
      EXECUTE 'SELECT EXISTS (
                 SELECT 1
                   FROM scanner_revoked_tickets revoked
                   JOIN tickets ticket ON ticket.token = btrim(revoked.ticket_token)
                   JOIN users active
                     ON active.id = ticket.user_id
                    AND active.account_state = ''active''
                    AND active.anonymized_at IS NULL
                  WHERE NULLIF(btrim(revoked.ticket_token), '''') IS NOT NULL
               )' INTO conflict_found;
      IF conflict_found THEN
        RAISE EXCEPTION
          'H54 cannot retire a legacy ticket that is assigned to an active user; resolve the collision and retry'
          USING ERRCODE = '23514';
      END IF;
      EXECUTE 'SELECT EXISTS (
                 SELECT 1 FROM scanner_revoked_tickets
                  WHERE NULLIF(btrim(ticket_token), '''') IS NULL
               )' INTO malformed_found;
      IF malformed_found THEN
        RAISE EXCEPTION 'H54 legacy ticket tombstones contain an empty credential'
          USING ERRCODE = '23514';
      END IF;
      EXECUTE 'CREATE TEMP TABLE h54_legacy_tickets ON COMMIT DROP AS
               SELECT btrim(ticket_token) AS credential, min(revoked_at) AS revoked_at
                 FROM scanner_revoked_tickets
                GROUP BY btrim(ticket_token)';
      EXECUTE 'DROP TABLE scanner_revoked_tickets';
      EXECUTE $sql$
        CREATE TABLE scanner_revoked_tickets (
          credential_digest text PRIMARY KEY
            CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
          revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )
      $sql$;
      EXECUTE format(
        'INSERT INTO scanner_revoked_tickets (credential_digest, revoked_at)
         SELECT encode(hmac(format(''hackos:scanner-credential:v1:ticket:%%s'', credential), %L, ''sha256''), ''hex''),
                revoked_at
           FROM h54_legacy_tickets',
        secret
      );
      has_expiry := false;
      has_digest := true;
    ELSIF NOT has_digest THEN
      RAISE EXCEPTION 'H54 scanner ticket table has no recognized credential column; repair it before retrying'
        USING ERRCODE = '55006';
    END IF;

    IF has_expiry THEN
      EXECUTE 'ALTER TABLE scanner_revoked_tickets ALTER COLUMN expires_at DROP NOT NULL';
      EXECUTE 'UPDATE scanner_revoked_tickets SET expires_at = NULL WHERE expires_at IS NOT NULL';
      EXECUTE 'ALTER TABLE scanner_revoked_tickets DROP COLUMN expires_at';
    END IF;
  END IF;

  EXECUTE 'UPDATE scanner_revoked_tickets SET revoked_at = clock_timestamp() WHERE revoked_at IS NULL';
  EXECUTE 'ALTER TABLE scanner_revoked_tickets ALTER COLUMN revoked_at SET DEFAULT clock_timestamp()';
  EXECUTE 'ALTER TABLE scanner_revoked_tickets ALTER COLUMN revoked_at SET NOT NULL';
  EXECUTE 'SELECT EXISTS (
             SELECT 1 FROM scanner_revoked_tickets
              WHERE credential_digest !~ ''^[0-9a-f]{64}$''
           )' INTO malformed_found;
  IF malformed_found THEN
    RAISE EXCEPTION 'H54 scanner ticket denylist contains a malformed digest'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.scanner_revoked_tickets'::regclass
       AND contype = 'p'
  ) THEN
    EXECUTE 'ALTER TABLE scanner_revoked_tickets ADD PRIMARY KEY (credential_digest)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.scanner_revoked_tickets'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%credential_digest%64%'
  ) THEN
    EXECUTE 'ALTER TABLE scanner_revoked_tickets ADD CONSTRAINT scanner_revoked_tickets_credential_digest_check CHECK (credential_digest ~ ''^[0-9a-f]{64}$'')';
  END IF;
END;
$$;

-- ── transient tables and immutable form snapshots ─────────────────────────

CREATE TABLE IF NOT EXISTS user_email_history (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (btrim(email) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, email)
);
CREATE INDEX IF NOT EXISTS user_email_history_email
  ON user_email_history (lower(email));
INSERT INTO user_email_history (user_id, email)
SELECT u.id, lower(btrim(address))
  FROM users u
 CROSS JOIN LATERAL unnest(ARRAY[u.email, u.secondary_email]) AS addresses(address)
 WHERE NULLIF(btrim(address), '') IS NOT NULL
ON CONFLICT (user_id, email) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_removal_pin_challenges (
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
CREATE INDEX IF NOT EXISTS account_removal_pin_challenges_user
  ON account_removal_pin_challenges (user_id, created_at DESC);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS current_form_version integer DEFAULT 1;
UPDATE applications SET current_form_version = 1 WHERE current_form_version IS NULL;
ALTER TABLE applications
  ALTER COLUMN current_form_version SET DEFAULT 1,
  ALTER COLUMN current_form_version SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.applications'::regclass
       AND conname = 'applications_current_form_version_check'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_current_form_version_check CHECK (current_form_version > 0);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS application_form_versions (
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
INSERT INTO application_form_versions (application_id, version, template, sections)
SELECT id, current_form_version, template, sections
  FROM applications a
 WHERE NOT EXISTS (
   SELECT 1 FROM application_form_versions v
    WHERE v.application_id = a.id
      AND v.version = a.current_form_version
 );

ALTER TABLE application_responses
  ADD COLUMN IF NOT EXISTS application_form_version_id bigint;
UPDATE application_responses response
   SET application_form_version_id = version.id
  FROM applications application
  JOIN application_form_versions version
    ON version.application_id = application.id
   AND version.version = application.current_form_version
 WHERE response.application_form_version_id IS NULL
   AND response.application_id = application.id;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM application_responses WHERE application_form_version_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'H54 cannot bind every application response to an immutable form snapshot; repair the affected application rows'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.application_form_versions'::regclass
       AND conname = 'application_form_versions_application_id_id_key'
  ) THEN
    ALTER TABLE application_form_versions
      ADD CONSTRAINT application_form_versions_application_id_id_key
      UNIQUE (application_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.application_responses'::regclass
       AND conname = 'application_responses_application_form_version_id_fkey'
  ) THEN
    ALTER TABLE application_responses
      ADD CONSTRAINT application_responses_application_form_version_id_fkey
      FOREIGN KEY (application_form_version_id)
      REFERENCES application_form_versions(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.application_responses'::regclass
       AND conname = 'application_responses_form_version_application_fk'
  ) THEN
    ALTER TABLE application_responses
      ADD CONSTRAINT application_responses_form_version_application_fk
      FOREIGN KEY (application_id, application_form_version_id)
      REFERENCES application_form_versions(application_id, id) ON DELETE RESTRICT;
  END IF;
END;
$$;
ALTER TABLE application_responses
  ALTER COLUMN application_form_version_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS application_responses_form_version
  ON application_responses (application_form_version_id);

-- ── synthetic fixture graph ───────────────────────────────────────────────

ALTER TABLE repos
  ADD COLUMN IF NOT EXISTS is_test_account boolean DEFAULT false;
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS is_test_account boolean DEFAULT false;
UPDATE repos SET is_test_account = false WHERE is_test_account IS NULL;
UPDATE challenges SET is_test_account = false WHERE is_test_account IS NULL;
ALTER TABLE repos ALTER COLUMN is_test_account SET DEFAULT false, ALTER COLUMN is_test_account SET NOT NULL;
ALTER TABLE challenges ALTER COLUMN is_test_account SET DEFAULT false, ALTER COLUMN is_test_account SET NOT NULL;
CREATE INDEX IF NOT EXISTS repos_test_account_idx ON repos (id) WHERE is_test_account = true;
CREATE INDEX IF NOT EXISTS challenges_test_account_idx ON challenges (id) WHERE is_test_account = true;

CREATE TABLE IF NOT EXISTS review_fixture_accounts (
  fixture_key text PRIMARY KEY CHECK (btrim(fixture_key) <> ''),
  user_id integer UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  last_authenticated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE review_fixture_accounts
  ADD COLUMN IF NOT EXISTS last_authenticated_at timestamptz;
DROP TRIGGER IF EXISTS review_fixture_accounts_updated_at ON review_fixture_accounts;
CREATE TRIGGER review_fixture_accounts_updated_at
  BEFORE UPDATE ON review_fixture_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO review_fixture_accounts (fixture_key)
VALUES
  ('participant-delete'),
  ('participant-anonymize-outside'),
  ('participant-anonymize-inside'),
  ('staff-exit-operator')
ON CONFLICT (fixture_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS review_fixture_queues (
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
DROP TRIGGER IF EXISTS review_fixture_queues_updated_at ON review_fixture_queues;
CREATE TRIGGER review_fixture_queues_updated_at
  BEFORE UPDATE ON review_fixture_queues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── final H54 functions and reference triggers ─────────────────────────────

CREATE OR REPLACE FUNCTION h54_prevent_form_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'application form versions are immutable'
    USING ERRCODE = '55006';
END;
$$;

DROP TRIGGER IF EXISTS h54_application_form_version_immutable ON application_form_versions;
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

DROP TRIGGER IF EXISTS h54_user_email_history ON users;
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

DROP TRIGGER IF EXISTS users_badge_assigned_at ON users;
CREATE TRIGGER users_badge_assigned_at
  BEFORE INSERT OR UPDATE OF badge_id ON users
  FOR EACH ROW EXECUTE FUNCTION h54_set_badge_assigned_at();

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
  -- Detaching an identity is safe during removal cleanup.
  IF referenced_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_referenced_user_id := NULLIF(to_jsonb(OLD)->>TG_ARGV[0], '')::bigint;
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
             SELECT 1 FROM event_config
              WHERE id = 1
                AND event_ends_at = cutoff
                AND event_ends_at <= clock_timestamp()
           )
         )
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

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

-- Better Auth's verification table has no user FK.  Keep only identifiers
-- that still belong to a live account, matching the squashed 0730 behavior.
DELETE FROM verifications
 WHERE NOT EXISTS (
   SELECT 1
     FROM users active
    WHERE active.account_state = 'active'
      AND active.anonymized_at IS NULL
      AND (
        lower(active.email) = lower(verifications.identifier)
        OR (
          active.secondary_email IS NOT NULL
          AND lower(active.secondary_email) = lower(verifications.identifier)
        )
        OR active.id::text = verifications.identifier
      )
 );
