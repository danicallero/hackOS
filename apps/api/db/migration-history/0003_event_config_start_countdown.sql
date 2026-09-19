-- 0003_event_config_start_countdown.sql — foundation.
--
-- DELTA(H47): lets organisers opt into a live "hacking starts in" countdown
-- before hacking_starts_at, instead of the default frozen-duration display.
-- Public countdown behaviour, not a new domain concept.
ALTER TABLE event_config
  ADD COLUMN show_start_countdown boolean NOT NULL DEFAULT false;
