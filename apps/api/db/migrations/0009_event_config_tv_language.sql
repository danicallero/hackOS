-- 0009_event_config_tv_language.sql — foundation.
--
-- DELTA(H42): the venue TV wall must render in a fixed, operator-chosen
-- language, never a signed-in caller's own account language preference (a
-- staff session cookie in the kiosk browser must not change what the wall
-- shows). Persisted like the Wi-Fi credentials (0008) so it survives control-
-- page reloads and applies even when nobody is at the control page (a
-- scheduled tv_slot, restarts). NULL means "no override" — the TV falls back
-- to its default language. Read by the TV feed only (GET /api/tv/config).
ALTER TABLE event_config
  ADD COLUMN tv_language text CHECK (tv_language IN ('es', 'gl', 'en'));
