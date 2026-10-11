-- DELTA(H38, H25): Live Activities / Live Updates registry (#966).
--
-- plan/schema-boceto.dbml only models `push_tokens` (one Expo token per
-- device, for ordinary notifications). System Live Activity surfaces need
-- extra per-device and per-activity delivery state that the Expo token does
-- not carry:
--
-- * live_activity_devices: one row per app install (`device_id` is the
--   client-generated install id). iOS 17.2+ exposes an ActivityKit
--   push-to-start token so the server can start the activity remotely;
--   Android receives data-only Expo pushes on `expo_push_token`. `enabled`
--   is the user's per-device opt-out. A device that signs in under another
--   account is reassigned (same single-owner rule as push_tokens).
-- * live_activity_sessions: one row per (device, kind, subject) Live
--   Activity the server knows about — started remotely by the worker or
--   locally by the app — with the iOS per-activity push token, the hash and
--   props of the last state sent (to update only on change and to send a
--   final content-state on end), and why it ended. The unique key is the
--   worker's idempotent start claim: INSERT … ON CONFLICT DO NOTHING lets
--   exactly one concurrent tick send a start.
CREATE TABLE live_activity_devices (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL UNIQUE CHECK (length(device_id) BETWEEN 1 AND 200),
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  push_to_start_token text,
  expo_push_token text,
  language text CHECK (language IN ('es', 'gl', 'en')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_activity_devices_user_idx ON live_activity_devices (user_id);

CREATE TRIGGER live_activity_devices_updated_at BEFORE UPDATE ON live_activity_devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE live_activity_sessions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id integer NOT NULL REFERENCES live_activity_devices(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('queue', 'activity')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 100),
  activity_push_token text,
  state_hash text,
  props jsonb,
  last_sent_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  -- 'finished': the server ended it (window closed, team done, activity
  -- over) and may start it again if it becomes relevant. 'dismissed': the
  -- user or the app ended it; the worker never restarts it remotely.
  end_reason text CHECK (end_reason IN ('finished', 'dismissed')),
  UNIQUE (device_id, kind, subject),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX live_activity_sessions_open_idx ON live_activity_sessions (device_id)
  WHERE ended_at IS NULL;
