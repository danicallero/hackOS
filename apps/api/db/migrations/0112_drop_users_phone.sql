-- DELTA(H7): remove the phone field from the user data model. Diverges from
-- plan/schema-boceto.dbml (users.phone) and the H7 story text — flagged, not
-- silently resolved; plan/ is not updated by this migration.

ALTER TABLE users DROP COLUMN phone;
