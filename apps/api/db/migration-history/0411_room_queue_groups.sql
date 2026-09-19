-- 0411_room_queue_groups.sql
-- DELTA(H46): a room serves a queue_group, not a bare challenge.
--
-- room_challenges (0001_initial.sql:209-215, made unique-per-room by
-- 0401_room_single_challenge.sql) is renamed and repointed onto
-- queue_groups(id) (0410_queue_groups.sql). "Which enterprise does this room
-- judge for" becomes derivable — room_queue_groups → queue_groups.enterprise_id
-- — so no separate room_enterprises table is needed, and there is exactly one
-- source of truth for the link.
--
-- The repoint is lossless by construction: 0410 gave every challenge exactly
-- one queue_group (1:1 backfill + an AFTER INSERT trigger on challenges that
-- keeps it true for rows created since), so every room_challenges row maps to
-- exactly one queue_group_id. The NOT NULL below is the assertion that held.
--
-- Product behaviour is unchanged by this migration: every group is still 1:1
-- with a challenge, so "one room, one challenge" remains true — it is now
-- expressed one level up.
--
-- Schema delta vs plan/schema-boceto.dbml: room_challenges → room_queue_groups
-- (challenge_id → queue_group_id).

ALTER TABLE room_challenges RENAME TO room_queue_groups;

ALTER TABLE room_queue_groups ADD COLUMN queue_group_id integer;

UPDATE room_queue_groups rqg
   SET queue_group_id = qgc.queue_group_id
  FROM queue_group_challenges qgc
 WHERE qgc.challenge_id = rqg.challenge_id;

-- Fails loudly if 0410's "every challenge has exactly one queue_group"
-- invariant ever stopped holding, rather than silently dropping the link.
ALTER TABLE room_queue_groups ALTER COLUMN queue_group_id SET NOT NULL;

ALTER TABLE room_queue_groups
  ADD CONSTRAINT room_queue_groups_queue_group_id_fk
  FOREIGN KEY (queue_group_id) REFERENCES queue_groups(id) ON DELETE CASCADE;

-- The primary key was (room_id, challenge_id); challenge_id is going away.
ALTER TABLE room_queue_groups DROP CONSTRAINT room_challenges_pkey;
ALTER TABLE room_queue_groups DROP COLUMN challenge_id;
ALTER TABLE room_queue_groups ADD PRIMARY KEY (room_id, queue_group_id);

-- 0401's one-active-thing-per-room invariant, renamed rather than re-derived:
-- a room still serves exactly one queue_group (equivalently, one enterprise)
-- at a time.
ALTER TABLE room_queue_groups
  DROP CONSTRAINT room_challenges_room_id_unique,
  ADD CONSTRAINT room_queue_groups_room_id_unique UNIQUE (room_id);

CREATE INDEX room_queue_groups_group ON room_queue_groups (queue_group_id);
