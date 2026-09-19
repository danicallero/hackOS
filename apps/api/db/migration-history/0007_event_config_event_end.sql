-- 0007_event_config_event_end.sql — foundation.
--
-- DELTA(H45/H47, H28): when the event ends — for multi-day events this is
-- what tells Apple Wallet the pass is over: it becomes the pass's
-- expirationDate, so Wallet stops surfacing it once the event finishes.
-- Paired with event_starts_at (doors open) from 0006.
ALTER TABLE event_config
  ADD COLUMN event_ends_at timestamptz;

ALTER TABLE event_config ADD CONSTRAINT event_config_event_window
  CHECK (
    event_starts_at IS NULL
    OR event_ends_at IS NULL
    OR event_ends_at > event_starts_at
  );
