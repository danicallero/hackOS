-- 0502_schedule_publish_reminder_indexes.sql — WS-C, H47/H48/H51.
-- No schema shape change: schedule.publish_at and schedule.reminded_at have
-- existed since 0001_initial.sql but nothing polled them (issue #80 audit
-- gap). Partial indexes for the two new background pollers this migration's
-- sibling code adds: the scheduled-visibility publisher (schedule-publisher.ts)
-- and the activity reminder job (schedule-reminders.ts).

CREATE INDEX schedule_pending_publish ON schedule (publish_at)
  WHERE visibility = 'hidden' AND publish_at IS NOT NULL;

CREATE INDEX schedule_pending_reminder ON schedule (starts_at)
  WHERE reminded_at IS NULL;
