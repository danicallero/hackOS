-- 0733_account_removal_reference_guards.sql — H54 writer race hardening.
--
-- 0730/0731/0732 are immutable once a deployment has applied them. Keep this
-- correction separate: every persisted FK reference to users must be created
-- while that user is still active. The trigger takes a row share lock, which
-- serializes the write with removal's user-row FOR UPDATE lock. If removal
-- wins the race, the reference is rejected; if the writer wins, its row is
-- committed before removal can move the account to removal_pending.

CREATE OR REPLACE FUNCTION h54_require_active_user_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_user_id bigint;
BEGIN
  referenced_user_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::bigint;
  IF referenced_user_id IS NULL THEN
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
  'H54: prevent new identity-bearing FK rows after account removal begins.';

-- Existing databases may contain a malformed legacy value. NOT VALID preserves
-- that history for staff review while enforcing the domain on every new or
-- edited row, and the presence readers explicitly ignore anything outside the
-- two door kinds.
ALTER TABLE time_logs
  ADD CONSTRAINT time_logs_kind_check CHECK (kind IN ('in', 'out')) NOT VALID;

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
  LOOP
    trigger_name := format('h54_active_user_%s', fk.column_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      trigger_name,
      fk.schema_name,
      fk.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I.%I '
      'FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference(%L)',
      trigger_name,
      fk.column_name,
      fk.schema_name,
      fk.table_name,
      fk.column_name
    );
  END LOOP;
END;
$$;
