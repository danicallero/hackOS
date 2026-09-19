-- 0823_clean_production_schema.sql — DELTA(H8/H10/H11): remove columns and
-- compatibility state that were retained only while the role/event-access
-- rollout was in flight. A fresh production schema has one authority:
-- application_grants_roles + user_roles + roles.event_access.
--
-- Existing deployments receive this as an ordinary forward-only cleanup.
-- Historical migration files and their checksums stay untouched; staging data
-- is deliberately not a compatibility contract for the production baseline.

ALTER TABLE applications DROP COLUMN type;

DROP TABLE manual_attendee_roles;
