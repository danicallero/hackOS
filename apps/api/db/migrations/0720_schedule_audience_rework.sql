-- 0718_schedule_audience_rework.sql — WS-C (schedule/activities, revises H59).
-- Reworks the H59 audience model: `staff` is dropped from the stored set —
-- every live item is unconditionally visible to staff, so it was always
-- redundant to store. `public` is dropped too and merged into `participant`
-- (the anonymous public site/TV feed now serves exactly the `participant`
-- slice — there's no attendee-facing audience distinct from "what
-- participants see"). `mentor` is added as its own toggle, alongside the
-- existing `sponsor`. An empty audiences array is now valid and means
-- "staff-only" — no default audience is forced on create anymore.
ALTER TABLE schedule DROP CONSTRAINT schedule_audiences_valid;

UPDATE schedule
   SET audiences = COALESCE(
     (SELECT array_agg(DISTINCT x)
        FROM unnest(array_replace(audiences, 'public', 'participant')) AS x
       WHERE x <> 'staff'),
     '{}'
   );

ALTER TABLE schedule ALTER COLUMN audiences SET DEFAULT '{}';
ALTER TABLE schedule
  ADD CONSTRAINT schedule_audiences_valid CHECK (
    audiences <@ ARRAY['sponsor', 'participant', 'mentor']::text[]
  );
