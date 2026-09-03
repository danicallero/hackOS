-- 0814_review_fixture_sign_in_ip.sql — DELTA(H54): retain the trusted origin
-- of the most recent successful sign-in for the current synthetic account.
--
-- The fixture dashboard already stores one bounded last-authenticated signal.
-- This adds the matching request IP without retaining failed attempts, user
-- agents, credentials, or a sign-in history. The value comes from Fastify's
-- trust-proxy-aware request.ip, never from a client-provided field.
ALTER TABLE review_fixture_accounts
  ADD COLUMN IF NOT EXISTS last_authenticated_ip text;

COMMENT ON COLUMN review_fixture_accounts.last_authenticated_ip IS
  'Most recent trusted request IP for a successful synthetic fixture sign-in; no failed-attempt or user-agent history is stored.';
