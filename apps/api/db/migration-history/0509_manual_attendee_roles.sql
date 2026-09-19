-- 0509_manual_attendee_roles.sql — DELTA(H8,H22): manual attendee type is a
-- relationship with an audit actor, never a permissions role on users.
CREATE TABLE manual_attendee_roles (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('participant', 'mentor')),
  assigned_by integer REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now()
);
