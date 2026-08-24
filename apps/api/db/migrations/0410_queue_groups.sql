-- 0410_queue_groups.sql
-- DELTA(H46): queue groups — the routing/naming layer a room (and, later, a
-- judging queue) attaches to instead of a bare challenge_id.
--
-- A queue group belongs to exactly ONE enterprise and gathers 1..N of that
-- enterprise's challenges into a single logical judging queue. Every existing
-- challenge gets its own 1:1 group here (display_name = the challenge title),
-- so "challenge without a group" is never a state the rest of the system has
-- to special-case, and today's per-challenge behaviour stays the default:
-- nothing is merged automatically. Merging N challenges into one shared group
-- is an explicit admin action, shipped later.
--
-- Nothing reads these tables yet. This migration is inert plumbing: it adds
-- no behaviour, and no existing query changes. The room_challenges →
-- room_queue_groups repoint and the query-layer changes that consume this
-- follow in a separate PR.
--
-- Schema delta vs plan/schema-boceto.dbml: two new tables (queue_groups,
-- queue_group_challenges); room_challenges is untouched by this migration.

CREATE TABLE queue_groups (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enterprise_id integer NOT NULL REFERENCES enterprises(id),
  -- admin-facing name of the queue this group represents; defaults to the
  -- challenge title for the auto-created 1:1 groups, so nothing looks
  -- different until an enterprise actually merges challenges.
  display_name text NOT NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER queue_groups_updated_at BEFORE UPDATE ON queue_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX queue_groups_enterprise ON queue_groups (enterprise_id);

-- Which challenges feed this group's queue. UNIQUE on challenge_id alone
-- (not on the pair) is what makes "a challenge belongs to at most ONE group,
-- ever" a hard invariant — a challenge is either in a shared group or in its
-- own 1:1 group, never both.
CREATE TABLE queue_group_challenges (
  queue_group_id integer NOT NULL REFERENCES queue_groups(id) ON DELETE CASCADE,
  challenge_id integer NOT NULL REFERENCES challenges(id) ON DELETE CASCADE UNIQUE,
  PRIMARY KEY (queue_group_id, challenge_id)
);

CREATE INDEX queue_group_challenges_group ON queue_group_challenges (queue_group_id);

-- A group must never span enterprises: every member challenge's owning
-- enterprise (challenges.author → sponsors.enterprise_id) has to equal the
-- group's enterprise_id. Plain FKs cannot express that cross-table equality,
-- and this is a hard invariant rather than a service-layer preference, so it
-- is enforced in the database.
--
-- Constraint triggers (AFTER, deferrable) rather than BEFORE row triggers:
-- a group row and its first member row are legitimately written by a single
-- statement (see the backfill below), which a BEFORE trigger's snapshot would
-- not see.
CREATE FUNCTION queue_group_enterprise_guard() RETURNS trigger AS $$
DECLARE
  target_group integer;
  offender integer;
BEGIN
  IF TG_TABLE_NAME = 'queue_groups' THEN
    target_group := NEW.id;
  ELSE
    target_group := NEW.queue_group_id;
  END IF;

  SELECT qgc.challenge_id INTO offender
    FROM queue_group_challenges qgc
    JOIN queue_groups qg ON qg.id = qgc.queue_group_id
    JOIN challenges c ON c.id = qgc.challenge_id
    JOIN sponsors s ON s.id = c.author
   WHERE qgc.queue_group_id = target_group
     AND s.enterprise_id IS DISTINCT FROM qg.enterprise_id
   LIMIT 1;

  IF offender IS NOT NULL THEN
    RAISE EXCEPTION
      'queue_group % cannot contain challenge %: it belongs to a different enterprise',
      target_group, offender
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER queue_group_challenges_enterprise_guard
  AFTER INSERT OR UPDATE ON queue_group_challenges
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION queue_group_enterprise_guard();

CREATE CONSTRAINT TRIGGER queue_groups_enterprise_guard
  AFTER UPDATE OF enterprise_id ON queue_groups
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION queue_group_enterprise_guard();

-- Re-pointing a challenge at a sponsor of another enterprise would break the
-- same invariant from the other side; that path has no product surface today
-- (challenges.author is set at creation), so it is deliberately not guarded
-- here — add a third trigger if a "transfer challenge to another enterprise"
-- feature ever appears.

-- Every new challenge gets its own 1:1 group, matching the backfill below.
-- Enforced in the database rather than in the challenges service so the
-- "every challenge has exactly one group" invariant cannot be bypassed by
-- direct SQL, seeds, or imports — the follow-up migration that repoints
-- room_challenges onto queue_group_id depends on it holding for rows created
-- between the two PRs.
CREATE FUNCTION challenge_default_queue_group() RETURNS trigger AS $$
DECLARE
  new_group integer;
BEGIN
  INSERT INTO queue_groups (enterprise_id, display_name)
  SELECT s.enterprise_id, NEW.title
    FROM sponsors s
   WHERE s.id = NEW.author
  RETURNING id INTO new_group;

  INSERT INTO queue_group_challenges (queue_group_id, challenge_id)
  VALUES (new_group, NEW.id);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER challenges_default_queue_group
  AFTER INSERT ON challenges
  FOR EACH ROW EXECUTE FUNCTION challenge_default_queue_group();

-- >>> backfill:queue_groups_1to1 (kept verbatim in an integration test)
-- One statement, not two: the group ids are drawn from the identity sequence
-- up front so each new group can be carried back to the challenge that caused
-- it. Matching groups back by (enterprise_id, display_name) would break for
-- two same-titled challenges of one enterprise.
WITH src AS (
  SELECT c.id AS challenge_id,
         s.enterprise_id,
         c.title,
         nextval(pg_get_serial_sequence('queue_groups', 'id')) AS group_id
    FROM challenges c
    JOIN sponsors s ON s.id = c.author
   WHERE NOT EXISTS (
     SELECT 1 FROM queue_group_challenges qgc WHERE qgc.challenge_id = c.id
   )
), inserted_groups AS (
  INSERT INTO queue_groups (id, enterprise_id, display_name)
  OVERRIDING SYSTEM VALUE
  SELECT group_id, enterprise_id, title FROM src
  RETURNING id
)
INSERT INTO queue_group_challenges (queue_group_id, challenge_id)
SELECT group_id, challenge_id FROM src;
-- <<< backfill:queue_groups_1to1
