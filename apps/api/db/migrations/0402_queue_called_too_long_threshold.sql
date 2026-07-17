-- 0402_queue_called_too_long_threshold.sql
-- DELTA(H34, H203): configurable called-too-long warning threshold, owned by
-- backend read model instead of the frontend's temporary
-- max(10 min, 2x desired minutes/team) fallback (#190/#203).

ALTER TABLE queue_settings
  ADD COLUMN called_too_long_threshold_minutes integer NOT NULL DEFAULT 10
    CHECK (called_too_long_threshold_minutes > 0);
