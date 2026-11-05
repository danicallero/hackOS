-- DELTA(H13): form-level default for which answers the review modal hides.
-- Reviewers can still reveal every answer; this only sets the standard view.
ALTER TABLE applications
  ADD COLUMN review_hidden_fields text[] DEFAULT '{}'::text[] NOT NULL;
