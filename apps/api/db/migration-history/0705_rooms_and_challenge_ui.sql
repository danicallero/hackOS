-- 0704_rooms_and_challenge_ui.sql
-- Room admin and challenge-level queue tuning.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS max_in_waiting_area integer NOT NULL DEFAULT 2;
