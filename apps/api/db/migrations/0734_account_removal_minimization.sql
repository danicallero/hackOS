-- 0734_account_removal_minimization.sql — H54 corrective retention boundary.
--
-- There is no production database in the scope of this change, but migration
-- history is still append-only. Keep the correction explicit so a fresh
-- install and a future upgrade have the same privacy contract.

-- The permanent anonymous audit subject contains the aggregate guaranteed
-- venue time, not raw door/accreditation events. Raw timestamps, scan kinds,
-- methods, notes, and actor metadata are operational records and are not one
-- of the seven approved long-term anonymous fields. 0730 temporarily added
-- anonymous foreign keys so its legacy conversion could finish safely; remove
-- the converted rows and the now-unused columns here.
DELETE FROM check_in_logs WHERE anonymous_participant_id IS NOT NULL;
DELETE FROM time_logs WHERE anonymous_participant_id IS NOT NULL;

ALTER TABLE check_in_logs
  DROP CONSTRAINT IF EXISTS check_in_logs_subject_check;
ALTER TABLE time_logs
  DROP CONSTRAINT IF EXISTS time_logs_subject_check;
DROP INDEX IF EXISTS check_in_logs_anonymous_participant;
DROP INDEX IF EXISTS time_logs_anonymous_participant;
ALTER TABLE check_in_logs DROP COLUMN IF EXISTS anonymous_participant_id;
ALTER TABLE time_logs DROP COLUMN IF EXISTS anonymous_participant_id;

COMMENT ON TABLE anonymous_participants IS
  'H54 permanent minimum audit subject: approved demographics and aggregate verified venue time only; id is random and has no relationship to users.id.';
COMMENT ON COLUMN anonymous_participants.guaranteed_presence_minutes IS
  'H24 verified/guaranteed venue time, rounded down to complete minutes at anonymization. Raw presence events are not retained after anonymization.';

-- A denormalized historical email can remain after a profile email change
-- (for example, an imported Devpost participant whose user FK was detached).
-- Keep the history only while the authenticated user exists so removal can
-- scrub all old addresses in the same transaction; ON DELETE CASCADE makes it
-- impossible for this helper table to become an identity bridge.
CREATE TABLE IF NOT EXISTS user_email_history (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (btrim(email) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, email)
);

COMMENT ON TABLE user_email_history IS
  'H54 transient cleanup aid only. Rows are deleted with the user and must never be copied to an anonymous subject.';

CREATE INDEX IF NOT EXISTS user_email_history_email
  ON user_email_history (lower(email));

INSERT INTO user_email_history (user_id, email)
SELECT u.id, lower(btrim(address))
  FROM users u
 CROSS JOIN LATERAL unnest(ARRAY[u.email, u.secondary_email]) AS addresses(address)
 WHERE NULLIF(btrim(address), '') IS NOT NULL
ON CONFLICT (user_id, email) DO NOTHING;

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

COMMENT ON FUNCTION h54_capture_user_email_history() IS
  'H54: records old and current email values only until the owning user is removed.';

DROP TRIGGER IF EXISTS h54_user_email_history ON users;
CREATE TRIGGER h54_user_email_history
AFTER UPDATE OF email, secondary_email ON users
FOR EACH ROW EXECUTE FUNCTION h54_capture_user_email_history();
