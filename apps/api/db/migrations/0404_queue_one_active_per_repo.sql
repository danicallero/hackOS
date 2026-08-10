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
CREATE UNIQUE INDEX one_active_entry_per_repo ON queue_entries (repo_id)
  WHERE status IN ('called', 'in_room', 'presenting');
