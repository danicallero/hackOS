-- 0405_enterprise_judges.sql
-- DELTA(Hxx): judges are enterprise-scoped, not room-scoped. Replaces the
-- judge half of `room_judges` (0001_initial.sql:217-224), which 0406 drops
-- once every consumer reads this table instead. A judge need not be a
-- `sponsors(enterprise_id, user_id)` rep — an enterprise may add ANY user to
-- its roster ("outside judges"), and a roster judge may judge in any room
-- currently serving one of that enterprise's challenges.
CREATE TABLE enterprise_judges (
  enterprise_id integer NOT NULL REFERENCES enterprises(id),
  user_id integer NOT NULL REFERENCES users(id),
  added_by integer REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, user_id)
);
CREATE INDEX enterprise_judges_user ON enterprise_judges (user_id);

-- Backfill from the room-scoped rows: a room judge for challenge C becomes a
-- roster judge of the enterprise that authored C. A user who judged for two
-- different enterprises correctly gets one row per enterprise.
-- Provenance is approximate for pre-existing multi-room judges: when the same
-- user held several `room_judges` rows within the SAME enterprise, DISTINCT ON
-- keeps the earliest assignment's `assigned_by`/`assigned_at`. That metadata is
-- audit-only and affects no access decision.
INSERT INTO enterprise_judges (enterprise_id, user_id, added_by, added_at)
SELECT DISTINCT ON (s.enterprise_id, rj.user_id)
       s.enterprise_id, rj.user_id, rj.assigned_by, rj.assigned_at
  FROM room_judges rj
  JOIN challenges c ON c.id = rj.challenge_id
  JOIN sponsors s ON s.id = c.author
 ORDER BY s.enterprise_id, rj.user_id, rj.assigned_at ASC
ON CONFLICT (enterprise_id, user_id) DO NOTHING;
