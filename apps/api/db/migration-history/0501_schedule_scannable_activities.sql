-- DELTA(H25,H26,H48): scheduled meals and registrable items are the source
-- of truth for scanner activities.

ALTER TABLE schedule
  ADD COLUMN requires_scan boolean NOT NULL DEFAULT false;

ALTER TABLE activities
  ADD COLUMN schedule_id integer UNIQUE REFERENCES schedule(id) ON DELETE SET NULL;

-- Existing meals were always intended to be scannable. Existing non-meal
-- schedule entries have no historical registrable flag, so stay unscannable.
INSERT INTO activities (name, description, category, requires_scan, schedule_id)
SELECT
  s.title,
  s.description,
  CASE WHEN s.type = 'meal' THEN 'meal' ELSE COALESCE(NULLIF(s.type, ''), 'activity') END,
  s.type = 'meal',
  s.id
FROM schedule s;

UPDATE schedule SET requires_scan = true WHERE type = 'meal';
