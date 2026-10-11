-- DELTA(H38, H25, H26, H59, H19, H22, H8): Live Activities / Live Updates
-- registry and their organizer configuration (#966).
--
-- plan/schema-boceto.dbml only models `push_tokens` (one Expo token per
-- device, for ordinary notifications) and has no Live Activity model. System
-- Live Activity surfaces need extra per-device and per-activity delivery
-- state that the Expo token does not carry, plus event-wide configuration:
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
--   worker's idempotent start claim: INSERT … ON CONFLICT lets exactly one
--   concurrent tick send a start. Kinds: `queue` (participant queue),
--   `activity` (staff meal/activity), `attendee_activity` (an opted-in
--   schedule item for its audience), `deadline` (submission countdown) and
--   `accreditation` (the check-in desk).
-- * schedule.live_activity_audience: per-item opt-in for the attendee Live
--   Activity. It lives on `schedule`, next to `audiences`, because the
--   schedule row is what staff edit and what decides who sees the item; the
--   linked `activities` row only mirrors it for scanning.
-- * live_activity_settings (singleton): how many Live Activities one device
--   shows at once.
-- * live_activity_kind_settings / live_activity_kind_roles: per-kind on/off,
--   priority (0 = highest) and the roles allowed to receive it. A kind's
--   intrinsic gate (capability or data, e.g. activity:scan or a queue
--   entry) still applies on top of the role list. Roles created later are not
--   added automatically.
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
  kind text NOT NULL
    CHECK (kind IN ('queue', 'activity', 'attendee_activity', 'deadline', 'accreditation')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 100),
  activity_push_token text,
  state_hash text,
  props jsonb,
  last_sent_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  -- 'finished': the server ended it (window closed, team done, activity
  -- over) and may start it again if it becomes relevant. 'dismissed': the
  -- user swiped it away or the app ended it; the worker restarts it
  -- remotely only once its phase differs from `dismissed_phase` (e.g. the
  -- dismissed waiting queue activity comes back when the team is called).
  end_reason text CHECK (end_reason IN ('finished', 'dismissed')),
  dismissed_phase text,
  UNIQUE (device_id, kind, subject),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX live_activity_sessions_open_idx ON live_activity_sessions (device_id)
  WHERE ended_at IS NULL;

ALTER TABLE schedule ADD COLUMN live_activity_audience boolean NOT NULL DEFAULT false;

CREATE TABLE live_activity_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_concurrent integer NOT NULL DEFAULT 2 CHECK (max_concurrent BETWEEN 1 AND 5),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER live_activity_settings_updated_at BEFORE UPDATE ON live_activity_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO live_activity_settings (id, max_concurrent) VALUES (1, 2);

CREATE TABLE live_activity_kind_settings (
  kind text PRIMARY KEY
    CHECK (kind IN ('activity', 'attendee_activity', 'queue', 'deadline', 'accreditation')),
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL CHECK (priority >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Deferred so one save can permute priorities.
  CONSTRAINT live_activity_kind_settings_priority_key UNIQUE (priority) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER live_activity_kind_settings_updated_at BEFORE UPDATE ON live_activity_kind_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE live_activity_kind_roles (
  kind text NOT NULL REFERENCES live_activity_kind_settings(kind) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (kind, role_id)
);
CREATE INDEX live_activity_kind_roles_role_idx ON live_activity_kind_roles (role_id);

-- Product owner order: staff meals/activities first, the submission
-- countdown last.
INSERT INTO live_activity_kind_settings (kind, enabled, priority) VALUES
  ('activity', true, 0),
  ('attendee_activity', true, 1),
  ('queue', true, 2),
  ('accreditation', true, 3),
  ('deadline', true, 4);

-- Capability-gated kinds: every live role that explicitly allows the kind's
-- intrinsic capability.
INSERT INTO live_activity_kind_roles (kind, role_id)
SELECT k.kind, r.id
  FROM (VALUES ('activity', 'activity:scan'),
               ('accreditation', 'accredit:scan'),
               ('deadline', 'queue:status')) AS k(kind, capability)
  JOIN role_capabilities rc ON rc.capability = k.capability AND rc.state = 'allow'
  JOIN roles r ON r.id = rc.role_id AND r.deleted_at IS NULL;

-- Data-gated, attendee-facing kinds: every live role with event access.
INSERT INTO live_activity_kind_roles (kind, role_id)
SELECT k.kind, r.id
  FROM (VALUES ('attendee_activity'), ('queue')) AS k(kind)
  JOIN roles r ON r.deleted_at IS NULL AND r.event_access = true;
