-- 0732_account_removal_meal_inbox.sql — H54 transient meal-scan minimization.
--
-- A pending inbox item needs its badge to retry an offline scan. Once the
-- item is terminal, the badge is no longer needed: the result is retained for
-- operational counts only and must not become a second identity-bearing
-- history table. processMealScanBatch clears badge_id on processed/failed
-- items; removal also clears/deletes pending rows for the affected badge.
ALTER TABLE meal_scan_batch_items
  ALTER COLUMN badge_id DROP NOT NULL;

COMMENT ON COLUMN meal_scan_batch_items.badge_id IS
  'H54 transient retry credential; NULL after terminal processing and never part of audit history.';
