-- DELTA(H24): there is no "door location" — presence is a single venue
-- in/out signal, not per-door tracking. Drop the column.
ALTER TABLE time_logs DROP COLUMN location;
