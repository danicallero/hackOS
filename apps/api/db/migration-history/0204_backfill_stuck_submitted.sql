-- DELTA(H13): "submitted" is a deprecated pre-review state. submitResponse
-- now always lands directly on "review" (or "confirmed" if invited) — there
-- is no separate start-review step anymore — but rows created before that
-- change could be stuck at "submitted" with no path forward. Fold them into
-- "review", the only status that's actually actionable by staff.

UPDATE application_responses
SET status = 'review'
WHERE status = 'submitted';
