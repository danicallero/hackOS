-- 0742_account_removal_pending_recovery.sql — H54 reversible pending exit.
--
-- An inside-venue anonymization request is accepted immediately, but the
-- participant may cancel it until staff record the exit or the request's
-- fixed recovery window expires. Keep the deadline separate from Better
-- Auth's rolling session expiry so signing out and signing back in cannot
-- extend the cancellation window.

ALTER TABLE users
  ADD COLUMN removal_expires_at timestamptz;

COMMENT ON COLUMN users.removal_expires_at IS
  'H54 pending-exit recovery deadline captured when anonymization is requested; never extended by later sign-ins.';

CREATE INDEX users_removal_expiry
  ON users (removal_expires_at)
  WHERE account_state = 'removal_pending' AND removal_expires_at IS NOT NULL;

-- Older pending rows were already inaccessible and had no reversible
-- recovery contract. Give any such row a bounded finalization deadline so a
-- worker cannot leave it pending forever. Fresh H54 rows use an active
-- session expiry (or the service fallback) instead.
UPDATE users
   SET removal_expires_at = COALESCE(
     removal_expires_at,
     removal_started_at + interval '1 hour',
     clock_timestamp() + interval '1 hour'
   )
 WHERE account_state = 'removal_pending'
   AND removal_expires_at IS NULL;
