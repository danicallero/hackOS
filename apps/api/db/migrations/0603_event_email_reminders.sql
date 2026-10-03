-- DELTA(H45,H52): event settings can schedule an entrance-ticket reminder.
CREATE TABLE event_email_reminders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'queued', 'cancelled', 'expired')),
  queued_at timestamptz,
  recipient_count integer NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX event_email_reminders_one_pending ON event_email_reminders ((true)) WHERE status = 'scheduled';
