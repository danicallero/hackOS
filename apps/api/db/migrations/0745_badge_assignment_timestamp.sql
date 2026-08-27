-- 0745_badge_assignment_timestamp.sql — H23/H54 stale offline scan boundary.
--
-- DELTA(H23,H54): a badge scan carries a device event time, while the current
-- badge assignment is mutable.  Keep the assignment boundary on the current
-- user row so presence/activity/meal replay can reject an event recorded
-- before a replacement badge was issued.

ALTER TABLE users
  ADD COLUMN badge_assigned_at timestamptz;

-- This branch has no production database.  Existing rows are rebuilt from the
-- fresh schema; if an upgrade ever contains an already-assigned badge, the
-- migration deliberately starts its accepted offline-scan window now rather
-- than guessing an identity-bearing historical assignment time.
UPDATE users
   SET badge_assigned_at = clock_timestamp()
 WHERE badge_id IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_badge_assignment_timestamp_check
  CHECK ((badge_id IS NULL) = (badge_assigned_at IS NULL));

CREATE OR REPLACE FUNCTION h54_set_badge_assigned_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.badge_id IS NULL THEN
    NEW.badge_assigned_at := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.badge_id IS DISTINCT FROM OLD.badge_id THEN
    NEW.badge_assigned_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION h54_set_badge_assigned_at() IS
  'H23/H54: record the current physical badge assignment boundary; never an audit identity or anonymous-retention value.';

CREATE TRIGGER users_badge_assigned_at
BEFORE INSERT OR UPDATE OF badge_id ON users
FOR EACH ROW EXECUTE FUNCTION h54_set_badge_assigned_at();

COMMENT ON COLUMN users.badge_assigned_at IS
  'H23/H54 transient current-badge assignment boundary used to reject stale offline scan timestamps.';
