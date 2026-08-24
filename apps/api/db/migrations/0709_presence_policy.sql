-- Optional event-wide presence policy.
-- Early accreditation creates a future entry at presence_auto_entry_at;
-- accreditation after that instant creates the entry at the actual check-in.
ALTER TABLE event_config
  ADD COLUMN presence_auto_entry_at timestamptz,
  ADD COLUMN presence_certainty_window_minutes integer NOT NULL DEFAULT 720,
  ADD CONSTRAINT event_config_presence_window_positive
    CHECK (presence_certainty_window_minutes BETWEEN 15 AND 10080);

CREATE INDEX time_logs_user_scanned_at ON time_logs (user_id, scanned_at DESC, id DESC);
