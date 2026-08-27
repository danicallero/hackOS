-- 0746_permanent_scanner_tombstones.sql — H54/F16 strict credential retirement.
--
-- This branch has no deployed database. A retired badge or ticket credential
-- is security metadata, not an audit subject, and must never become valid
-- again merely because a compatibility expiry elapsed. Physical badge reuse
-- is handled by assignment timestamps before removal; account-retired
-- credentials remain permanently denied. The older nullable expiry column is
-- removed rather than carried as a dormant compatibility escape hatch.

DROP INDEX IF EXISTS scanner_revoked_badges_expiry;
DROP INDEX IF EXISTS scanner_revoked_tickets_expiry;

ALTER TABLE scanner_revoked_badges
  DROP COLUMN expires_at;
ALTER TABLE scanner_revoked_tickets
  DROP COLUMN expires_at;

COMMENT ON TABLE scanner_revoked_badges IS
  'H54 unlinked keyed-digest denylist for permanently retired badge credentials. No participant relationship or raw badge value is retained.';
COMMENT ON TABLE scanner_revoked_tickets IS
  'H54 unlinked keyed-digest denylist for permanently retired ticket credentials. No participant relationship or raw ticket value is retained.';
