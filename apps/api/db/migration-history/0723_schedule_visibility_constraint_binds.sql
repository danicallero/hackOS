-- 0721_schedule_visibility_constraint_binds.sql — WS-C (schedule/activities, H59 follow-up).
-- 0720 added schedule_visibility_requires_audience, but it never actually
-- rejected anything: array_length('{}'::text[], 1) is NULL, not 0, so
-- `array_length(audiences, 1) > 0` evaluates to NULL for the empty array —
-- and a CHECK that evaluates to NULL passes. Every staff-only row could still
-- be stored as visibility='shown' with a publish_at, which is exactly the
-- state 0720 set out to make unrepresentable.
-- coalesce() makes it bind. Rows that drifted into the dead state while the
-- constraint was inert are normalized first, same as 0720 did.
-- DELTA(H59): no schema shape change vs plan/schema-boceto.dbml, only the
-- check that was already documented there now being enforced.
UPDATE schedule
   SET visibility = 'hidden', publish_at = NULL
 WHERE coalesce(array_length(audiences, 1), 0) = 0
   AND (visibility <> 'hidden' OR publish_at IS NOT NULL);

ALTER TABLE schedule
  DROP CONSTRAINT IF EXISTS schedule_visibility_requires_audience;

ALTER TABLE schedule
  ADD CONSTRAINT schedule_visibility_requires_audience CHECK (
    coalesce(array_length(audiences, 1), 0) > 0
    OR (visibility = 'hidden' AND publish_at IS NULL)
  );
