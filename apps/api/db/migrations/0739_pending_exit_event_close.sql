-- 0739_pending_exit_event_close.sql — H54 valid system-generated exit.
--
-- The event-end closer is a valid exit for a participant who requested
-- anonymization before the event ended. Its audit timestamp can be earlier
-- than removal_started_at, so extend the pending-exit trigger only for the
-- exact system-generated event-end row. Manual/offline rows still need to be
-- recorded after the request and close the current open session.

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

  -- A pending participant may receive one of two kinds of closure:
  -- 1. a current manual/live exit after removal_started_at; or
  -- 2. the exact event-end automatic exit, which may be timestamped before
  --    the request if the request arrived after event_ends_at but before the
  --    periodic closer ran.
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
  'H54: prevent new identity-bearing FK rows after removal begins; permit a current pending exit or the exact event-end system exit.';
