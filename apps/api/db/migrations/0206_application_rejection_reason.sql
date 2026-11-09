-- DELTA(H14): optional reason recorded with an internal rejection. Visible to
-- reviewers at once; the applicant sees it only once the decision is sent.
ALTER TABLE application_responses
  ADD COLUMN rejection_reason text,
  ADD CONSTRAINT application_responses_rejection_reason_check
    CHECK (rejection_reason IS NULL OR (btrim(rejection_reason) <> '' AND char_length(rejection_reason) <= 1000));
