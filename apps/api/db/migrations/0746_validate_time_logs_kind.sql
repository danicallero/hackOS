-- 0746_validate_time_logs_kind.sql — H24/H54 malformed-row cleanup.
--
-- DELTA(H24,H54): migration 0733 used NOT VALID so an already-populated
-- deployment could install the writer guard without first deciding what to do
-- with malformed historical rows. This branch has no production database and
-- does not preserve those rows for compatibility. Remove them, then validate
-- the constraint so every subsequent presence calculation can rely on the
-- schema rather than carrying a legacy exception forever.

DELETE FROM time_logs
 WHERE kind NOT IN ('in', 'out');

ALTER TABLE time_logs
  VALIDATE CONSTRAINT time_logs_kind_check;
