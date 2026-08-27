-- 0743_review_fixture_accounts.sql — H54 App Store review fixtures.
--
-- Test accounts are synthetic operational fixtures, not a second participant
-- lifecycle.  The marker is used only by aggregate/statistics queries and by
-- the admin fixture reset path; operational lookups must continue to resolve
-- these accounts so staff can exercise scanners against them.

ALTER TABLE users
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_test_account IS
  'Synthetic App Store/QA fixture marker. Excluded from participant statistics, but not from authorized operational lookups or actions.';

ALTER TABLE anonymous_participants
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN anonymous_participants.is_test_account IS
  'Synthetic audit subject marker. Test-derived anonymous rows are excluded from statistics and removed when the fixture generation is replaced.';

CREATE INDEX users_test_account_idx
  ON users (id)
  WHERE is_test_account = true;

CREATE INDEX anonymous_participants_test_account_idx
  ON anonymous_participants (id)
  WHERE is_test_account = true;

-- The registry contains only the current synthetic fixture account for each
-- stable review scenario.  user_id is a temporary pointer to the active
-- synthetic account, not an anonymous-participant mapping; account removal
-- sets it NULL and never stores an anonymous id here.
CREATE TABLE review_fixture_accounts (
  fixture_key text PRIMARY KEY CHECK (btrim(fixture_key) <> ''),
  user_id integer UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER review_fixture_accounts_updated_at
  BEFORE UPDATE ON review_fixture_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE review_fixture_accounts IS
  'Current synthetic App Store/QA account pointers. Never use this table for real participants or as an anonymous identity lookup.';
COMMENT ON COLUMN review_fixture_accounts.fixture_key IS
  'Stable scenario key, such as participant-delete or participant-anonymize-inside.';
COMMENT ON COLUMN review_fixture_accounts.user_id IS
  'Current synthetic account only; ON DELETE SET NULL prevents an identity mapping surviving account removal.';

-- Explicit initial review scenarios.  The API also inserts these keys
-- idempotently so fresh test suites that truncate domain data remain usable.
INSERT INTO review_fixture_accounts (fixture_key)
VALUES
  ('participant-delete'),
  ('participant-anonymize-outside'),
  ('participant-anonymize-inside'),
  ('staff-exit-operator')
ON CONFLICT (fixture_key) DO NOTHING;
