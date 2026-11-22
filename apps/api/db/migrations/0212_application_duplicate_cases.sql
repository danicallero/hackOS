-- DELTA(H13,H54): duplicate applications. Some applicants create a second
-- account to apply twice. Reviewers look at pairs of responses to the same
-- form that share a DNI or have similar names/emails, and either dismiss a
-- pair (not the same person) or propose merging it. A proposal stores the
-- merged answers chosen field by field and emails both addresses a private
-- link: the applicant picks the account to keep (the other one is deleted
-- through the H54 removal flow) or says the two are different people.
--
-- Not in plan/schema-boceto.dbml: detection itself is computed on read and
-- stores nothing; only reviewer decisions and pending proposals are rows.
CREATE TABLE application_duplicate_cases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  -- The pair, lowest response id first. Both become NULL once their response
  -- is deleted (the discarded side of a merge, or an account removal); the
  -- stable pair_key keeps a dismissal attached to the pair until then.
  first_response_id integer REFERENCES application_responses(id) ON DELETE SET NULL,
  second_response_id integer REFERENCES application_responses(id) ON DELETE SET NULL,
  pair_key text NOT NULL,
  -- dismissed: a reviewer said they are different people.
  -- pending: a merge proposal is waiting for the applicant.
  -- merged / kept_separate: the applicant answered.
  -- cancelled: a reviewer withdrew the proposal.
  status text NOT NULL
    CHECK (status IN ('dismissed', 'pending', 'merged', 'kept_separate', 'cancelled')),
  -- Proposal only. Cleared when the case is resolved: the merged answers then
  -- live on the kept response, and a refused merge must not keep a copy.
  merged_responses jsonb,
  -- Which response's submission date and status the merged response keeps.
  submitted_from_response_id integer,
  -- md5 of each response's answers/status/submission at proposal time; a
  -- response edited afterwards makes the proposal outdated.
  source_fingerprints jsonb,
  -- sha256 of the link sent to each response's owner; never the raw token.
  first_token_hash text UNIQUE,
  second_token_hash text UNIQUE,
  expires_at timestamptz,
  kept_response_id integer REFERENCES application_responses(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_by integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_duplicate_cases_proposal_check CHECK (
    status <> 'pending' OR (
      merged_responses IS NOT NULL AND submitted_from_response_id IS NOT NULL
      AND source_fingerprints IS NOT NULL AND first_token_hash IS NOT NULL
      AND second_token_hash IS NOT NULL AND expires_at IS NOT NULL
    )
  )
);

-- One open decision per pair: a dismissed, pending or kept-separate pair is
-- not offered again; a cancelled proposal can be proposed again.
CREATE UNIQUE INDEX application_duplicate_cases_open_pair_idx
  ON application_duplicate_cases (application_id, pair_key)
  WHERE status IN ('dismissed', 'pending', 'kept_separate');

CREATE INDEX application_duplicate_cases_application_idx
  ON application_duplicate_cases (application_id, created_at DESC);

CREATE TRIGGER application_duplicate_cases_set_updated_at
  BEFORE UPDATE ON application_duplicate_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE application_duplicate_cases IS
  'H13/H54 duplicate applications: reviewer dismissals and merge proposals answered by the applicant through an emailed link.';
