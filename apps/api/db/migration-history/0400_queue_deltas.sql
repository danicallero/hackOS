-- 0400_queue_deltas.sql — WS-B2 (queue & judging core, H29-H42) schema deltas.
-- Base tables (rooms, room_challenges, room_judges, room_queue_state,
-- queue_settings, queue_entries, queue_history, attempt_review,
-- attempt_review_versions, judging_session) already exist from 0001_initial.sql.
-- This migration only fills gaps discovered while implementing the state
-- machine + pump.

-- DELTA(H29): the pump (plan/07 §5.1) calls call_next automatically with no
-- human operator behind it. queue_history.actor_id was NOT NULL; system-
-- driven history rows need a nullable actor (audit_log.actor_id is already
-- nullable for the same reason).
ALTER TABLE queue_history ALTER COLUMN actor_id DROP NOT NULL;

-- DELTA(H38): pre-call ("faltan pocos minutos") warnings must fire once per
-- call cycle, not on every pump tick while the ETA stays under the
-- threshold. Tracks the last time this entry got a pre-call notification;
-- cleared whenever the entry leaves `waiting` (see queue module).
ALTER TABLE queue_entries ADD COLUMN precalled_at timestamptz;

-- Perf: H30's "member busy in another room" guard joins submissions to
-- itself on user_id for every call_next candidate.
CREATE INDEX submissions_user ON submissions (user_id);

-- Perf: ordering waiting/called entries within a challenge's shared queue.
CREATE INDEX queue_entries_challenge_position ON queue_entries (challenge_id, position);

-- DELTA(H36): guardrail — attempt_review.status is read as an enum-like
-- string throughout the module (draft|submitted); the base migration left it
-- as a bare text column.
ALTER TABLE attempt_review ADD CONSTRAINT attempt_review_status_check
  CHECK (status IN ('draft', 'submitted'));

-- DELTA(H31/H36): judging_session tracks live presence ("quién más está
-- viendo esta ficha ahora"). Without a partial unique index, repeated
-- join-session calls (tab refresh, reconnect) pile up open rows forever.
CREATE UNIQUE INDEX judging_session_active ON judging_session (judge_id, queue_entry_id)
  WHERE ended_at IS NULL;
