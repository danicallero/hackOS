-- 0004_event_config_venue_pass_fields.sql — foundation.
--
-- DELTA(H45/H47, H28): extends event_config with the venue's GPS coordinates
-- (drives the Apple Wallet pass's lock-screen `locations` relevance, H28) and
-- an admin-editable list of Wallet pass back-field label/value pairs — the
-- old HackUDC pkpassBuilder script kept these as hardcoded data in
-- generar_pases.py; here they become event_config the same way the hacking
-- window is, so organisers edit them from the settings page instead of code.
ALTER TABLE event_config
  ADD COLUMN venue_name text,
  ADD COLUMN venue_latitude double precision,
  ADD COLUMN venue_longitude double precision,
  ADD COLUMN pass_back_fields jsonb NOT NULL DEFAULT '[]';

ALTER TABLE event_config ADD CONSTRAINT event_config_venue_coords_paired
  CHECK ((venue_latitude IS NULL) = (venue_longitude IS NULL));
