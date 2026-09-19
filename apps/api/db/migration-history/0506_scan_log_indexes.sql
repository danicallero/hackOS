-- Staff-scoped scan history/stats (extends H22-H27 logistics/accreditation):
-- team-wide scan-log feed and per-staff counts both filter by the actor
-- column on each log table (who performed the scan, not who was scanned),
-- which had no index before this.
-- DELTA(H22-H27): no table change vs plan/schema-boceto.dbml — indexes only.
CREATE INDEX check_in_logs_staff ON check_in_logs (staff_id, checked_in_at DESC);
CREATE INDEX time_logs_scanned_by ON time_logs (scanned_by, scanned_at DESC);
CREATE INDEX activity_logs_logged_by ON activity_logs (logged_by, logged_at DESC);
