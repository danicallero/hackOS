-- 0720_schedule_visibility_requires_audience.sql — WS-C (schedule/activities, H59 follow-up).
-- Codifies the rule product asked for explicitly: an item with an empty
-- `audiences` array has no meaningful "visibility" at all — it's neither
-- public nor private, it's staff-only, full stop, and staff already sees
-- every item unconditionally regardless of `visibility`/`publish_at`
-- (schedule.ts listScheduleForAudiences). `visibility`/`publish_at` only
-- describe *when a tagged audience* gets to see an item, so they're
-- meaningless — and now disallowed — without at least one audience tag.
-- Existing rows that drifted into that dead state (shown/scheduled with no
-- audience) are normalized first so the constraint can attach.
UPDATE schedule
   SET visibility = 'hidden', publish_at = NULL
 WHERE array_length(audiences, 1) IS NULL;

ALTER TABLE schedule
  ADD CONSTRAINT schedule_visibility_requires_audience CHECK (
    array_length(audiences, 1) > 0 OR (visibility = 'hidden' AND publish_at IS NULL)
  );
