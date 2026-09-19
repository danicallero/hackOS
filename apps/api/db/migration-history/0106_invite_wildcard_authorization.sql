-- DELTA(H8/H10): invitation group ids are deferred permission grants. Record
-- whether a current wildcard holder explicitly authorized a token that carries
-- (or later acquires through nesting) effective wildcard access. Existing
-- tokens default to false and therefore fail closed if their group closure
-- changes to include '*'.
ALTER TABLE email_verification_tokens
  ADD COLUMN wildcard_authorized boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN email_verification_tokens.wildcard_authorized IS
  'Durable proof that a wildcard holder authorized this deferred group grant.';
