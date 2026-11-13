-- 0709_schedule_speakers_enterprises.sql — speakers and companies on schedule items (H44, H48, H49).
--
-- DELTA(H48): plan/schema-boceto.dbml gives a schedule item only responsible
-- people ("owners", operational, staff-facing) and free-form audiences. A
-- speaker is the public counterpart: an account shown on the item and listed on
-- their public profile; `position` keeps the order staff chose. A company link
-- needs no speaker, so an item can be tied to an enterprise directly. A
-- company's page lists the items linked to it plus those spoken at by its
-- members. There is no story for speakers; H48 is the closest.

CREATE TABLE schedule_speakers (
  schedule_id integer NOT NULL REFERENCES schedule (id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (schedule_id, user_id)
);

CREATE INDEX schedule_speakers_user_id_idx ON schedule_speakers (user_id);

CREATE TABLE schedule_enterprises (
  schedule_id integer NOT NULL REFERENCES schedule (id) ON DELETE CASCADE,
  enterprise_id integer NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, enterprise_id)
);

CREATE INDEX schedule_enterprises_enterprise_id_idx ON schedule_enterprises (enterprise_id);
