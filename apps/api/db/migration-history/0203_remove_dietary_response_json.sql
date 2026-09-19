-- Dietary values have a single sensitive source of truth on users. Preserve
-- resumable drafts, but remove duplicate copies from every response that has
-- already left draft state. Do not backfill or reconstruct any removed value.
UPDATE application_responses
SET responses = responses - 'food_intolerances' - 'food_intolerance_notes'
WHERE status <> 'draft'
  AND responses ?| ARRAY['food_intolerances', 'food_intolerance_notes'];
