-- 0716_schedule_drop_checklist.sql — WS-C (schedule/activities, revises H59).
-- Prep checklist turned out not to be wanted — dropped in favor of the
-- simpler `notes` free-text field for the same "staff-only extra info" job.
ALTER TABLE schedule DROP COLUMN checklist;
