-- DELTA(H24): time_logs.scanned_by becomes nullable. NULL marks a
-- system-generated log — today only the event-end automatic exit: once
-- event_config.event_ends_at passes, a worker closes every still-open door
-- session with an audited `out` at that instant. This overrides the earlier
-- "the system never closes a session itself" stance (product decision); an
-- `out` that lands outside any certainty window credits no hours, so the
-- synthetic exit only restores the session invariant, never inflates totals.
ALTER TABLE time_logs ALTER COLUMN scanned_by DROP NOT NULL;
