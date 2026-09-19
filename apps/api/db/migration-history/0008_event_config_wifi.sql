-- 0008_event_config_wifi.sql — foundation.
--
-- DELTA(H42): the venue Wi-Fi credentials become event config instead of
-- living only inside a transient TV broadcast payload. A scheduled TV slot
-- (tv_slots, 0403) can show Wi-Fi with nobody at the control page, so the
-- credentials must survive mode changes and restarts. These are read by the
-- TV feed only (GET /api/tv/config), never by /api/public/event.
ALTER TABLE event_config
  ADD COLUMN wifi_ssid text,
  ADD COLUMN wifi_password text;
