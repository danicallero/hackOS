-- 0404_queue_one_active_per_repo.sql
-- DELTA(H30): database-level backstop for the "never call a team with
-- members occupied in another room" invariant (plan/07 §2, §4). The H30
-- guard (apps/api/src/modules/queue/guard.ts) already enforces this via
-- advisory-lock-serialized checks, but that check historically depended on
-- resolving the repo's members; a repo with no resolvable members at check
-- time (e.g. its active submission was withdrawn after being queued) could
-- bypass it. This index makes the same-repo case structurally impossible
-- regardless of the application-level check: a repo can have at most one
-- entry across ALL challenges in an active state (called/in_room/presenting)
-- at a time.
--
-- Backfill (H30): the guard gap this index closes let some repos already
-- accumulate more than one simultaneously-active entry before the fix
-- landed. Before the index can be created, demote all but one duplicate per
-- repo back to 'returned_to_queue' (still needs judging, re-enters the
-- queue) rather than silently discarding it. The kept entry is the one
-- furthest along the pipeline (presenting > in_room > called), tie-broken by
-- most recently updated — the team that's physically in front of judges
-- right now is the real one; the other is the stale artifact of the bug.
WITH ranked AS (
  SELECT id, repo_id, status,
         row_number() OVER (
           PARTITION BY repo_id
           ORDER BY
             CASE status WHEN 'presenting' THEN 3 WHEN 'in_room' THEN 2 ELSE 1 END DESC,
             updated_at DESC
         ) AS rn
  FROM queue_entries
  WHERE status IN ('called', 'in_room', 'presenting')
), losers AS (
  UPDATE queue_entries qe
  SET status = 'returned_to_queue', assigned_room_id = NULL
  FROM ranked r
  WHERE qe.id = r.id AND r.rn > 1
  RETURNING qe.id, r.repo_id, r.status AS previous_status
)
INSERT INTO queue_history (queue_entry_id, actor_id, previous_status, new_status, action, reason)
SELECT id, NULL, previous_status, 'returned_to_queue', 'system_dedup_h30',
       'H30 backfill: duplicate active entry for repo ' || repo_id || ' demoted before one_active_entry_per_repo index creation'
FROM losers;

CREATE UNIQUE INDEX one_active_entry_per_repo ON queue_entries (repo_id)
  WHERE status IN ('called', 'in_room', 'presenting');
