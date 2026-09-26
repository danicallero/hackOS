-- DELTA(H13): profile staff notes are the sole shared internal-note field.
ALTER TABLE application_responses DROP COLUMN staff_notes;
