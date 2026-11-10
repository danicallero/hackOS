-- DELTA(H59): a schedule item's audience may also name publicly visible roles
-- ("role:<id>"), next to the attendance audiences sponsor / participant / mentor.
-- Holding at least one of the named roles sees the item (and is asked for an
-- RSVP when it is enabled). The ids are checked in the API (an existing role
-- marked is_visible); the database only keeps the tag shape.
CREATE FUNCTION public.schedule_audiences_valid(tags text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(bool_and(tag IN ('sponsor', 'participant', 'mentor') OR tag ~ '^role:[0-9]+$'), true)
    FROM unnest(tags) AS tag
$$;

ALTER TABLE public.schedule DROP CONSTRAINT schedule_audiences_valid;
ALTER TABLE public.schedule
  ADD CONSTRAINT schedule_audiences_valid CHECK (public.schedule_audiences_valid(audiences));
