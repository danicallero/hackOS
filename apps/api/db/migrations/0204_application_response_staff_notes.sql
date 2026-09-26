-- DELTA(H13): profile staff notes are the sole shared internal-note field.
WITH latest_response_note AS (
  SELECT DISTINCT ON (user_id) user_id, staff_notes
    FROM application_responses
   WHERE staff_notes IS NOT NULL AND btrim(staff_notes) <> ''
   ORDER BY user_id, updated_at DESC, id DESC
)
UPDATE users
   SET notes = latest_response_note.staff_notes
  FROM latest_response_note
 WHERE users.id = latest_response_note.user_id
   AND (users.notes IS NULL OR btrim(users.notes) = '');

ALTER TABLE application_responses DROP COLUMN staff_notes;
