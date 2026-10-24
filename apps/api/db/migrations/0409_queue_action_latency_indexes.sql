-- H29, H30, H32, H36, H38, H46: indexes for the lookups every queue action
-- and judge-panel read repeats. DELTA(H29): no table or column changes, only
-- access paths missing from the baseline (plan/schema-boceto.dbml unchanged).

-- findBusyMemberEntry (H30), call_next sibling checks, repo scope assertions
-- and every "this team's other entries" lookup filter queue_entries by
-- repo_id alone; the baseline only has (challenge_id, repo_id) and a partial
-- unique index limited to active statuses.
CREATE INDEX queue_entries_repo_status ON queue_entries (repo_id, status);

-- queue_group_timing() (H38/H39 pace) learns from the most recent completed
-- presentations of a group; read on every pace, ETA and pre-call evaluation.
CREATE INDEX queue_entries_completed_recent
  ON queue_entries (challenge_id, completed_at DESC)
  WHERE status = 'completed';

-- listActiveJudgingSessions / presence broadcasts (H36) look sessions up by
-- entry; the baseline unique index leads with judge_id.
CREATE INDEX judging_session_active_entry
  ON judging_session (queue_entry_id)
  WHERE ended_at IS NULL;

-- Contextual judge/sponsor access (H40, H46) joins sponsors by user and by
-- enterprise on every room, entry and challenge guard.
CREATE INDEX sponsors_user ON sponsors (user_id);
CREATE INDEX sponsors_enterprise ON sponsors (enterprise_id, user_id);
