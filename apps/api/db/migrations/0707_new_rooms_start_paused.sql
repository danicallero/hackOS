-- New rooms must remain operationally paused until a judge/operator resumes
-- them. The initial migration is updated too; this covers existing databases.
ALTER TABLE room_queue_state ALTER COLUMN is_paused SET DEFAULT true;
