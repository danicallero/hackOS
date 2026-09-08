-- 0816_university_suggestions.sql — DELTA(H12): self-service catalogue
-- proposals are attributable, one per person, while staff can still curate
-- the directory through the management endpoints.
ALTER TABLE universities
  ADD COLUMN suggested_by integer REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX universities_one_suggestion_per_user
  ON universities (suggested_by)
  WHERE suggested_by IS NOT NULL;

COMMENT ON COLUMN universities.suggested_by IS
  'H12: authenticated self-service proposer. Unlike proposed_by (which records every creator, including staff), a person may have at most one active suggestion.';
