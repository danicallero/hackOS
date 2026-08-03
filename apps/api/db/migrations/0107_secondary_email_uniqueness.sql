-- DELTA(H6): verified secondary identities are unique case-insensitively.
-- Pending addresses are deliberately excluded: they identify no account until
-- verification succeeds.
CREATE UNIQUE INDEX users_verified_secondary_email_unique
  ON users (lower(secondary_email))
  WHERE secondary_email_verified_at IS NOT NULL;

