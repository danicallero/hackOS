-- 0744_review_fixture_queues.sql — synthetic participant queue fixtures.
--
-- The queue/project markers are operational test metadata. They are separate
-- from anonymous audit retention and never create a relationship to a real
-- participant. Ordinary event views exclude marked rows; a synthetic reviewer
-- participant can still read its own queue through /api/queue/me.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;

ALTER TABLE repos
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;

ALTER TABLE challenges
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;

-- 0743's initial comments described fixture rows as visible to ordinary
-- operations. The product boundary is now explicit: ordinary event surfaces
-- exclude them, while the dedicated synthetic operator remains test-scoped.
COMMENT ON COLUMN users.is_test_account IS
  'Synthetic reviewer/QA fixture marker. Ordinary event operations and statistics exclude marked rows; dedicated synthetic operators are restricted to marked rows.';

COMMENT ON COLUMN anonymous_participants.is_test_account IS
  'Synthetic reviewer/QA audit subject marker. It is excluded from normal statistics and removed with the fixture generation; it is never an identity mapping.';

COMMENT ON COLUMN repos.is_test_account IS
  'Synthetic review-fixture project marker. Excluded from ordinary event operations and statistics.';

COMMENT ON COLUMN challenges.is_test_account IS
  'Synthetic review-fixture queue marker. Excluded from ordinary event operations and statistics.';

CREATE INDEX repos_test_account_idx
  ON repos (id)
  WHERE is_test_account = true;

CREATE INDEX challenges_test_account_idx
  ON challenges (id)
  WHERE is_test_account = true;

ALTER TABLE review_fixture_accounts
  ADD COLUMN last_authenticated_at timestamptz;

COMMENT ON COLUMN review_fixture_accounts.last_authenticated_at IS
  'Last successful synthetic fixture sign-in signal; no credential or participant response is stored.';

-- Exactly one generated project/queue per scenario. These foreign keys are
-- current fixture pointers, not identity mappings. The cleanup service reads
-- them before deleting the marked synthetic rows and then removes this row.
CREATE TABLE review_fixture_queues (
  fixture_key text PRIMARY KEY
    REFERENCES review_fixture_accounts(fixture_key) ON DELETE CASCADE,
  enterprise_id integer UNIQUE REFERENCES enterprises(id) ON DELETE SET NULL,
  sponsor_id integer UNIQUE REFERENCES sponsors(id) ON DELETE SET NULL,
  challenge_id integer UNIQUE REFERENCES challenges(id) ON DELETE SET NULL,
  repo_id integer UNIQUE REFERENCES repos(id) ON DELETE SET NULL,
  queue_entry_id integer UNIQUE REFERENCES queue_entries(id) ON DELETE SET NULL,
  generation integer NOT NULL CHECK (generation > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER review_fixture_queues_updated_at
  BEFORE UPDATE ON review_fixture_queues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE review_fixture_queues IS
  'Current synthetic queue/project pointers for reviewer fixtures. Never use as a participant-to-anonymous mapping.';
