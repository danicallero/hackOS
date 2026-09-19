-- DELTA(H13): free-text 0-100 score replaced by the same 0-10 button scale
-- used for judging (question-field.tsx SCORE_SCALE), for a faster and more
-- consistent staff scoring UI. Existing scores are proportionally rescaled
-- before the tightened CHECK, so no row violates the new constraint.

ALTER TABLE applicant_reviews
  DROP CONSTRAINT applicant_reviews_score_check;

UPDATE applicant_reviews
SET score = round(score / 10.0)
WHERE score IS NOT NULL;

ALTER TABLE applicant_reviews
  ADD CONSTRAINT applicant_reviews_score_check CHECK (score BETWEEN 0 AND 10);
