-- DELTA(#1083): organisers choose the certified-hours policy; there is no
-- preset award. NULL means use confirmed attendance; individual approvals win.
ALTER TABLE certificate_settings ADD COLUMN award_hours numeric(5,2)
  CHECK (award_hours IS NULL OR award_hours > 0);
COMMENT ON COLUMN certificate_settings.award_hours IS '#1083 optional configured certificate/university award; NULL uses confirmed attendance. No preset value.';
