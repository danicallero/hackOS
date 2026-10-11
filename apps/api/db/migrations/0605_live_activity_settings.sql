-- DELTA(H38, H25, H26, H8, H59): configurable Live Activity kinds (#966).
--
-- plan/schema-boceto.dbml has no Live Activity model (see 0604). This adds:
--
-- * Three more session kinds: `attendee_activity` (an opted-in schedule item
--   for its audience), `deadline` (submission countdown) and `accreditation`
--   (the check-in desk).
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
ALTER TABLE live_activity_sessions DROP CONSTRAINT live_activity_sessions_kind_check;
ALTER TABLE live_activity_sessions ADD CONSTRAINT live_activity_sessions_kind_check
  CHECK (kind IN ('queue', 'activity', 'attendee_activity', 'deadline', 'accreditation'));

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
