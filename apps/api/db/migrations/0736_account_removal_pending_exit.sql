-- 0736_account_removal_pending_exit.sql — H54 accepted in-venue requests.
--
-- `removal_pending` is an operational transition, not an alternate account
-- that can continue participating.  These two transient columns preserve only
-- enough state to finish a valid exit and replay the identity-free result.

ALTER TABLE users
  ADD COLUMN removal_requires_exit boolean NOT NULL DEFAULT false,
  ADD COLUMN removal_idempotency_key text;

-- A deployment can already contain a pending row from the previous removal
-- implementation. Give those rows a conservative cutoff before installing the
-- exit-only trigger; a NULL cutoff would make the safe exit path ambiguous.
UPDATE users
   SET removal_started_at = COALESCE(removal_started_at, updated_at, clock_timestamp())
 WHERE account_state = 'removal_pending'
   AND removal_started_at IS NULL;

COMMENT ON COLUMN users.removal_requires_exit IS
  'H54 transient gate: only a valid door exit may be written before final removal.';
COMMENT ON COLUMN users.removal_idempotency_key IS
  'H54 transient self-service replay key; never a mapping to an anonymous participant and deleted with the user.';

CREATE OR REPLACE FUNCTION h54_require_active_user_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_user_id bigint;
  cutoff timestamptz;
  removal_started_at_value timestamptz;
  latest_id bigint;
  latest_kind text;
BEGIN
  referenced_user_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::bigint;
  IF referenced_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The only identity-bearing write permitted after removal starts is the
  -- out scan that closes the participant's already-open venue session.  It is
  -- serialized by the same user-row lock as account removal.
  IF TG_TABLE_NAME = 'time_logs'
     AND TG_ARGV[0] = 'user_id'
     AND to_jsonb(NEW)->>'kind' = 'out' THEN
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
       AND removal_started_at_value IS NOT NULL
       AND cutoff >= removal_started_at_value
       AND latest_kind = 'in'
       AND (TG_OP <> 'UPDATE' OR latest_id = NULLIF(to_jsonb(NEW)->>'id', '')::bigint) THEN
      RETURN NEW;
    END IF;
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
  'H54: prevent new identity-bearing FK rows after removal begins; permit only the pending participant exit time log.';

-- 0733 guarded UPDATE OF user_id, but a direct SQL writer could otherwise
-- change an existing pending participant's `in` row to `out` (or vice versa)
-- by updating only `kind`. Recreate the time-log trigger with both columns in
-- its event list. The application still validates the open-session invariant;
-- this is the database-level fail-safe for writers that bypass the service.
DROP TRIGGER IF EXISTS h54_active_user_user_id ON time_logs;
CREATE TRIGGER h54_active_user_user_id
  BEFORE INSERT OR UPDATE ON time_logs
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('user_id');

-- 0733 guarded only UPDATE OF the FK column. Rebuild all user-reference
-- triggers for full-row UPDATE coverage: changing status, responses, notes,
-- scan metadata, or another column must not mutate a pending participant's
-- identity-bearing record through a side door. time_logs is excluded because
-- the specialized trigger above permits exactly the pending exit transition.
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
       AND c.relname <> 'time_logs'
  LOOP
    trigger_name := format('h54_active_user_%s', fk.column_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      trigger_name,
      fk.schema_name,
      fk.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I.%I '
      'FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference(%L)',
      trigger_name,
      fk.schema_name,
      fk.table_name,
      fk.column_name
    );
  END LOOP;
END;
$$;
