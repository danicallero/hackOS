-- DELTA(H51,H59): a device that schedules activity reminders itself reports
-- which items (and at which start time and lead) it covers, so the reminder
-- job can skip the push channel for fully covered users. Reports older than
-- the job's freshness window are ignored, so a stale device falls back to
-- the server push. Stored on the device row: it is per-token state that dies
-- with the token.
ALTER TABLE push_tokens
  ADD COLUMN local_reminders jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN local_reminders_lead_minutes integer,
  ADD COLUMN local_reminders_synced_at timestamptz;

-- DELTA(H19,H20): editing and submission close at the same instant
-- (`project_submissions_close_at`, which inherits `hacking_ends_at`); the
-- optional earlier editing lock is removed.
ALTER TABLE event_config DROP COLUMN project_edits_lock_at;
