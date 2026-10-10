-- DELTA(#926): persist the presentation clock independently of H35 room pause.
ALTER TABLE queue_entries
  ADD COLUMN presentation_paused_at timestamptz,
  ADD COLUMN presentation_paused_seconds double precision NOT NULL DEFAULT 0 CHECK (presentation_paused_seconds >= 0),
  ADD COLUMN presentation_total_seconds integer CHECK (presentation_total_seconds >= 0);

-- The previous browser-only goal cannot be recovered; existing presentations
-- adopt the shared queue's current capped target once at migration time (#926).
UPDATE queue_entries qe
SET presentation_total_seconds = (
  SELECT LEAST(min(c.target_seconds_per_team), min(c.max_presentation_seconds))
  FROM queue_group_challenges own
  JOIN queue_group_challenges sibling ON sibling.queue_group_id = own.queue_group_id
  JOIN challenges c ON c.id = sibling.challenge_id
  WHERE own.challenge_id = qe.challenge_id
)
WHERE qe.presentation_started_at IS NOT NULL;
