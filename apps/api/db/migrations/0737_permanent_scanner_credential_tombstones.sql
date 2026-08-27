-- 0737_permanent_scanner_credential_tombstones.sql — H54 stale-device safety.
--
-- A disconnected scanner can replay a credential long after the former user
-- row has been removed.  Expiring a revocation set makes that credential
-- eligible for reassignment and lets an old queue hit a new participant.  Keep
-- the credential in an unlinked global denylist instead.  These rows are not
-- participant records, contain no user/application FK, and are never copied
-- into anonymous audit data.  NULL expires_at means a permanent retirement.

ALTER TABLE scanner_revoked_badges
  ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE scanner_revoked_tickets
  ALTER COLUMN expires_at DROP NOT NULL;

-- Existing H54 tombstones are already detached from users. Promote them to
-- permanent non-reuse entries so the migration does not leave a stale replay
-- window merely because the removal happened before this correction.
UPDATE scanner_revoked_badges SET expires_at = NULL WHERE expires_at IS NOT NULL;
UPDATE scanner_revoked_tickets SET expires_at = NULL WHERE expires_at IS NOT NULL;

COMMENT ON TABLE scanner_revoked_badges IS
  'H54 global retired-credential denylist. Rows have no participant relationship; NULL expires_at prevents stale offline badge replay and badge reuse.';
COMMENT ON COLUMN scanner_revoked_badges.expires_at IS
  'NULL means permanently retired. A non-NULL value is legacy/temporary housekeeping only.';
COMMENT ON TABLE scanner_revoked_tickets IS
  'H54 global retired-credential denylist. Rows have no participant relationship; NULL expires_at prevents stale offline ticket replay and token reuse.';
COMMENT ON COLUMN scanner_revoked_tickets.expires_at IS
  'NULL means permanently retired. A non-NULL value is legacy/temporary housekeeping only.';
