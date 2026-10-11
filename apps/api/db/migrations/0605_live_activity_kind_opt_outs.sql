-- DELTA(H38, H25, H59, H19, H22): per-user Live Activity kind opt-outs (#966).
--
-- plan/schema-boceto.dbml has no Live Activity model (see 0604). Organizers
-- decide which kinds exist and for which roles; this table records the kinds
-- a user turned off for themselves. It is per user, not per device like
-- `live_activity_devices.enabled`: the candidates are computed per user, so
-- the choice follows the account to every install (and survives a reinstall
-- or a new device id), while the per-device switch stays the device-level
-- kill switch. Only opt-outs are stored: an absent row means "on", so a kind
-- a user becomes entitled to later starts on by default.
CREATE TABLE live_activity_kind_opt_outs (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('queue', 'activity', 'attendee_activity', 'deadline', 'accreditation')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
