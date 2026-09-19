-- 0412_queue_group_merge.sql
-- DELTA(H46): what a *merged* (N>1) queue group needs on top of 0410/0411.
--
-- 0410 created every group 1:1 with a challenge and 0411 routed rooms through
-- them, but nothing could ever produce a group with more than one challenge.
-- The admin merge action (POST /api/enterprises/:id/queue-groups/merge) does,
-- and it needs two things the schema did not have yet:
--
--   1. Somewhere to keep the *merged* judging form. Challenges each carry
--      their own `judging_panel_criteria`; a shared queue has exactly one
--      form for every challenge in it, built as a de-duplicating union of the
--      member challenges' questions and then reviewed/edited by the admin.
--      That canonical set belongs to the group, not to any one challenge.
--      NULL means "no merged form" — resolve the single member challenge's
--      own criteria, which is every 1:1 group and therefore today's behaviour.
--
--   2. `display_name` that can be trusted on its own. 0410 set it once at
--      group creation, so a renamed challenge left its 1:1 group's name
--      stale; read surfaces worked around that by showing the member
--      challenge's live title for a 1:1 group and only falling back to
--      `display_name` for a merged one. That conditional has to go now that a
--      group name is a real, admin-chosen thing — so instead the database
--      keeps a *solo* group's name following its challenge's title, and every
--      read surface just reads `display_name`.
--
-- Schema delta vs plan/schema-boceto.dbml: one new column
-- (queue_groups.judging_panel_criteria). No table is added, and
-- queue_entries / challenge_winners are untouched — a shared queue stays a
-- display/ordering layer over unchanged per-challenge rows.

ALTER TABLE queue_groups ADD COLUMN judging_panel_criteria jsonb;

COMMENT ON COLUMN queue_groups.judging_panel_criteria IS
  'Merged judging form for a shared queue (H46): the de-duplicated union of the member challenges'' judging_panel_criteria, admin-reviewed. NULL = resolve the member challenge''s own criteria (every 1:1 group).';

-- A solo group's name is its challenge's title, kept in sync. Only ever fires
-- for a group with exactly one member challenge: a merged group's name was
-- chosen by an admin and must never be overwritten by a challenge rename.
CREATE FUNCTION queue_group_sync_solo_display_name(target_challenge integer) RETURNS void AS $$
  UPDATE queue_groups qg
     SET display_name = c.title
    FROM queue_group_challenges qgc
    JOIN challenges c ON c.id = qgc.challenge_id
   WHERE qgc.challenge_id = target_challenge
     AND qg.id = qgc.queue_group_id
     AND qg.display_name IS DISTINCT FROM c.title
     AND (SELECT count(*) FROM queue_group_challenges q
           WHERE q.queue_group_id = qg.id) = 1;
$$ LANGUAGE sql;

CREATE FUNCTION challenge_title_syncs_queue_group() RETURNS trigger AS $$
BEGIN
  PERFORM queue_group_sync_solo_display_name(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER challenges_sync_queue_group_name
  AFTER UPDATE OF title ON challenges
  FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION challenge_title_syncs_queue_group();

-- Repair the drift 0410 left behind: every group that is still 1:1 takes its
-- challenge's current title. Groups with more than one challenge cannot exist
-- yet at this point in the migration order, but the count guard is written
-- anyway so re-running this file is safe after merges exist.
UPDATE queue_groups qg
   SET display_name = c.title
  FROM queue_group_challenges qgc
  JOIN challenges c ON c.id = qgc.challenge_id
 WHERE qg.id = qgc.queue_group_id
   AND qg.display_name IS DISTINCT FROM c.title
   AND (SELECT count(*) FROM queue_group_challenges q
         WHERE q.queue_group_id = qg.id) = 1;
