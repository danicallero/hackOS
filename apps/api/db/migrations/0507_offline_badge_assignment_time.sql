-- DELTA(H54): an accreditation made offline replays later, but the badge was
-- physically assigned when the operator did it. The server may now record that
-- (bounded) client time as the assignment boundary instead of the replay time,
-- so activity/presence scans taken with the badge in between are not rejected
-- as "predating the assignment". The service sets `hackos.badge_assigned_at`
-- (transaction-local) after validating it; without it the trigger behaves as
-- before and stamps clock_timestamp().
CREATE OR REPLACE FUNCTION public.h54_set_badge_assigned_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  client_time timestamptz := nullif(current_setting('hackos.badge_assigned_at', true), '')::timestamptz;
BEGIN
  IF NEW.badge_id IS NULL THEN
    NEW.badge_assigned_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.badge_assigned_at := COALESCE(client_time, clock_timestamp());
  ELSIF NEW.badge_id IS DISTINCT FROM OLD.badge_id THEN
    NEW.badge_assigned_at := COALESCE(client_time, clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;
