-- H12: a person's university is the library answer on their application
-- response; the profile column was never written by any surface and is dropped.
-- DELTA(H12): plan/schema-boceto.dbml still lists users.university_id.
ALTER TABLE users DROP COLUMN university_id;
