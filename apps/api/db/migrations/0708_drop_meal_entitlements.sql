-- DELTA(H25): meal entitlements removed — everyone has the right to eat, no
-- per-user grant is needed to scan a meal. Drops the gate table introduced in
-- 0001_initial.sql; activity_logs already carries the scan/repeat history.
DROP TABLE meal_entitlements;
