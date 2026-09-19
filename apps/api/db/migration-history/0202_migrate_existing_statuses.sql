-- DELTA(H14): migrate existing accepted/rejected rows that haven't been sent
-- to the new internal variants. This runs in its OWN transaction because
-- PostgreSQL requires new enum values to be committed before use (code 55P04).

UPDATE application_responses
SET status = 'accepted_internal'
WHERE status = 'accepted' AND decision_sent_at IS NULL;

UPDATE application_responses
SET status = 'rejected_internal'
WHERE status = 'rejected' AND decision_sent_at IS NULL;
