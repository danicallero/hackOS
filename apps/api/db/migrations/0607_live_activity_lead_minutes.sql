-- DELTA(H25, H26, H59, H45, #966): organizer-set Live Activity lead time.
--
-- plan/schema-boceto.dbml has no Live Activity model (see 0604). How long
-- before a scannable (staff) or opted-in (attendee) schedule item starts its
-- Live Activity appears was only the deployment's LIVE_ACTIVITY_LEAD_MINUTES.
-- It becomes an event setting. Only an intentional override is stored: NULL
-- means "use the deployment default" (the env value), so a deployment value
-- keeps flowing through until an organizer overrides it, and resetting
-- stores NULL again.
ALTER TABLE live_activity_settings
  ADD COLUMN lead_minutes integer CHECK (lead_minutes BETWEEN 0 AND 240);
