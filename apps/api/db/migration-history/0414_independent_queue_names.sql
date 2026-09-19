-- 0414_independent_queue_names.sql
-- DELTA(H46): a queue name belongs to its queue even when the queue currently
-- has one challenge. Keep the initial title-derived default from 0410, but do
-- not overwrite a sponsor/operator's later queue rename when the challenge is
-- edited.

DROP TRIGGER IF EXISTS challenges_sync_queue_group_name ON challenges;
DROP FUNCTION IF EXISTS challenge_title_syncs_queue_group();
DROP FUNCTION IF EXISTS queue_group_sync_solo_display_name(integer);
