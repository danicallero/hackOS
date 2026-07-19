-- 0103_users_anonymized_at.sql — DELTA(H54): explicit marker for scrubbed
-- accounts, so counts and mobile sync can exclude them. anonymizeUser()
-- previously only overwrote PII columns with no durable "this row is
-- anonymized" signal.

ALTER TABLE users ADD COLUMN anonymized_at timestamptz;
