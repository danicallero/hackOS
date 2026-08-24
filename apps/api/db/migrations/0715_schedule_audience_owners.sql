-- 0713_schedule_audience_owners.sql — WS-C (schedule/activities, extends H48).
-- A schedule item's `visibility`/`publish_at` only ever meant "is this live
-- at all, to everyone" — there was no way to scope an item to staff or
-- sponsors only (e.g. internal prep items, or a sponsor-only deadline). This
-- adds an orthogonal audience set, a staff-only prep checklist, an optional
-- contact override, and a many-to-many "who's responsible" join table
-- modeled on `sponsors` (enterprise members) — a flat resource-to-users
-- link, not the compound-key `room_judges` shape, since ownership here isn't
-- scoped to a second dimension.
--
-- DELTA(H59): `audiences` is deliberately independent of
-- `visibility`/`publish_at` (see schedule.ts's revealDueScheduleItems,
-- untouched by this migration) — an item can be live but staff-only.
ALTER TABLE schedule
  ADD COLUMN audiences text[] NOT NULL DEFAULT '{public}',
  ADD COLUMN checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN contact_note text;

ALTER TABLE schedule
  ADD CONSTRAINT schedule_audiences_valid CHECK (
    audiences <@ ARRAY['public', 'staff', 'sponsor']::text[]
    AND array_length(audiences, 1) > 0
  );

CREATE TABLE schedule_owners (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id integer NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by integer REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, user_id)
);

CREATE INDEX schedule_owners_schedule_id_idx ON schedule_owners (schedule_id);
