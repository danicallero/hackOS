-- DELTA(H14): split "accepted"/"rejected" into internal (unsent) vs sent variants
-- so the DB encodes what the applicant sees (plan/07 §3) instead of masking via
-- decision_sent_at null check.

ALTER TYPE app_response_status ADD VALUE 'accepted_internal';
ALTER TYPE app_response_status ADD VALUE 'rejected_internal';
