-- 0826_enterprise_priority.sql — sponsor tiers retired (H43-H45).
--
-- DELTA(H43-H45): sponsorship tiers were never a functional requirement and
-- their dangling foreign key made an otherwise valid enterprise impossible to
-- create. Each enterprise now owns its logo-grid priority directly (1 first).

ALTER TABLE enterprises DROP CONSTRAINT enterprises_tier_id_fkey;
ALTER TABLE enterprises DROP COLUMN tier_id;
ALTER TABLE enterprises RENAME COLUMN display_priority TO priority;
ALTER TABLE enterprises ADD CONSTRAINT enterprises_priority_check
  CHECK (priority IS NULL OR priority > 0);

DROP TABLE sponsor_tiers;
