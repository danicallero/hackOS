-- 0413_room_enterprises.sql
-- DELTA(H46): a room belongs to an enterprise's room pool, independently of
-- which single queue it is currently serving.
--
-- 0411's comment argued no separate room_enterprises table was needed because
-- "which enterprise does this room judge for" was derivable from
-- room_queue_groups -> queue_groups.enterprise_id. That held only while a
-- room's enterprise and its serving queue were the same decision. They no
-- longer are: an admin now assigns a room to an enterprise once, and which of
-- that enterprise's queues (if it runs more than one) actually calls from the
-- room is a separate, queue-scoped decision made from that queue's own page.
-- A room can belong to an enterprise's pool while serving no queue at all —
-- the enterprise may own more rooms than it currently needs.
--
-- Auto-linking (an enterprise running exactly one queue_group gets its rooms
-- wired into room_queue_groups automatically) is application logic in
-- apps/api/src/modules/queue/rooms.routes.ts, not this migration: it is a
-- convenience default, reversible any time from a queue's own room list
-- without touching room pool membership.
--
-- Backfill: every room already serving a queue_group is given a matching
-- room_enterprises row (its queue_group's enterprise) — lossless, since that
-- was the only way a room had an enterprise before this table existed.
--
-- Schema delta vs plan/schema-boceto.dbml: new table room_enterprises
-- (room_id, enterprise_id).

CREATE TABLE room_enterprises (
  room_id integer PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  enterprise_id integer NOT NULL REFERENCES enterprises(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by integer REFERENCES users(id)
);

CREATE INDEX room_enterprises_enterprise ON room_enterprises (enterprise_id);

INSERT INTO room_enterprises (room_id, enterprise_id, assigned_at, assigned_by)
SELECT rqg.room_id, qg.enterprise_id, rqg.assigned_at, rqg.assigned_by
  FROM room_queue_groups rqg
  JOIN queue_groups qg ON qg.id = rqg.queue_group_id;

-- A room may only actively serve a queue_group belonging to the enterprise it
-- is pooled into — the pool is the source of truth for "which enterprise",
-- room_queue_groups only for "which of that enterprise's queues, if any".
-- Same constraint-trigger shape as queue_group_enterprise_guard (0410) and
-- for the same reason: the cross-table equality a plain FK cannot express,
-- deferrable so a single statement can legitimately write both a room's pool
-- membership and its serving queue together.
CREATE FUNCTION room_queue_group_enterprise_guard() RETURNS trigger AS $$
DECLARE
  pooled_enterprise integer;
  group_enterprise integer;
BEGIN
  SELECT enterprise_id INTO pooled_enterprise
    FROM room_enterprises WHERE room_id = NEW.room_id;

  SELECT enterprise_id INTO group_enterprise
    FROM queue_groups WHERE id = NEW.queue_group_id;

  IF pooled_enterprise IS DISTINCT FROM group_enterprise THEN
    RAISE EXCEPTION
      'room % cannot serve queue_group %: it is pooled into a different enterprise',
      NEW.room_id, NEW.queue_group_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER room_queue_groups_enterprise_guard
  AFTER INSERT OR UPDATE ON room_queue_groups
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION room_queue_group_enterprise_guard();
