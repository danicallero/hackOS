-- 0002_event_config.sql — foundation. Singleton row of event-wide config.
--
-- DELTA(H45/H47): the hackathon's publicly-"spoken" hacking window (when the
-- clock starts and stops) drives countdowns on the public website and the TV
-- panels. It is distinct from the judging window (queue_settings.schedule_*)
-- and from the agenda (schedule table). Kept as a singleton like
-- queue_settings so reads are a trivial WHERE id = 1.
CREATE TABLE event_config (
  id integer PRIMARY KEY, -- singleton, id = 1
  name text,
  tagline text,
  timezone text NOT NULL DEFAULT 'Europe/Madrid',
  hacking_starts_at timestamptz, -- public countdown "start"
  hacking_ends_at timestamptz,   -- public countdown "end" (submissions close)
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1),
  CHECK (
    hacking_starts_at IS NULL
    OR hacking_ends_at IS NULL
    OR hacking_ends_at > hacking_starts_at
  )
);

INSERT INTO event_config (id) VALUES (1);

CREATE TRIGGER event_config_updated_at BEFORE UPDATE ON event_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
