-- 0741_keyed_scanner_credential_tombstones.sql — H54 credential minimization.
--
-- Retired scanner credentials are security metadata, not anonymous audit
-- subjects. Keep a stable keyed digest rather than a raw bearer token. This
-- branch has no production database; the earlier raw rows are discarded in
-- this fresh-schema chain because they cannot be converted without the
-- deployment secret. The current fail-closed application path continues to
-- reject retired values before resolving a current owner; per-assignment
-- binding remains a separate production decision for reusable badges.

ALTER TABLE scanner_revoked_badges
  RENAME COLUMN badge_id TO credential_digest;
ALTER TABLE scanner_revoked_tickets
  RENAME COLUMN ticket_token TO credential_digest;

-- 0730/0737 populated raw values before the keyed representation existed.
-- No production data is in scope for this branch, so do not mislabel those
-- values as digests or carry raw credentials forward.
DELETE FROM scanner_revoked_badges;
DELETE FROM scanner_revoked_tickets;

ALTER TABLE scanner_revoked_badges
  ADD CONSTRAINT scanner_revoked_badges_digest_check
  CHECK (credential_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE scanner_revoked_tickets
  ADD CONSTRAINT scanner_revoked_tickets_digest_check
  CHECK (credential_digest ~ '^[0-9a-f]{64}$');

COMMENT ON TABLE scanner_revoked_badges IS
  'H54 unlinked keyed-digest denylist for retired badge credentials. No participant relationship or raw badge value is retained; digest storage does not by itself make reusable physical badges safe.';
COMMENT ON COLUMN scanner_revoked_badges.credential_digest IS
  'HMAC-SHA256 of the retired badge credential under the deployment secret.';
COMMENT ON TABLE scanner_revoked_tickets IS
  'H54 unlinked keyed-digest denylist for retired ticket credentials. No participant relationship or raw ticket value is retained.';
COMMENT ON COLUMN scanner_revoked_tickets.credential_digest IS
  'HMAC-SHA256 of the retired ticket credential under the deployment secret.';
