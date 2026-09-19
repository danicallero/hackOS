-- DELTA(H13): application reviews use a compact 0-5 scale so the complete
-- reviewer control fits on one row. Existing 0-10 scores are converted before
-- tightening the constraint; judging-panel scores remain 0-10.

ALTER TABLE applicant_reviews
  DROP CONSTRAINT applicant_reviews_score_check;

UPDATE applicant_reviews
SET score = round(score / 2.0)::int
WHERE score IS NOT NULL;

ALTER TABLE applicant_reviews
  ADD CONSTRAINT applicant_reviews_score_check CHECK (score BETWEEN 0 AND 5);
