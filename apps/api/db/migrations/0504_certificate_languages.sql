-- DELTA(#1083): each language is a separate verifiable document; preserve
-- existing certificates and allow another language without revoking them.
DROP INDEX attendance_certificates_one_live;
CREATE UNIQUE INDEX attendance_certificates_one_live
  ON attendance_certificates (user_id, variant, locale) WHERE revoked_at IS NULL;
