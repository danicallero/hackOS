-- #997 (H38/H39/H46): one minutes-per-slot formula for every ETA reader —
-- project status, participant queue status, operator room pace and the
-- pre-call pump. A queue's learned cycle is split across its active
-- (unpaused) serving rooms; with no active room the full cycle is one slot.
CREATE FUNCTION queue_group_pace(group_id integer) RETURNS TABLE(
 target_minutes numeric, preparation_minutes numeric, sample_count bigint,
 observed_presentation_minutes numeric, observed_preparation_minutes numeric,
 estimated_cycle_minutes numeric, active_rooms integer, minutes_per_slot numeric)
LANGUAGE sql STABLE AS $$
SELECT t.target_minutes,t.preparation_minutes,t.sample_count,
 t.observed_presentation_minutes,t.observed_preparation_minutes,
 t.estimated_cycle_minutes,r.n,t.estimated_cycle_minutes/GREATEST(1,r.n)
FROM queue_group_timing(group_id) t
CROSS JOIN (
 SELECT count(*)::integer AS n FROM room_queue_groups rqg
 JOIN room_queue_state rqs ON rqs.room_id=rqg.room_id AND NOT rqs.is_paused
 WHERE rqg.queue_group_id=group_id
) r;
$$;

-- DELTA(H39): pace is owned by the track target (challenges.target_seconds_per_team,
-- 0304); the per-room target and its compatibility PATCH are retired.
ALTER TABLE room_queue_state DROP COLUMN desired_minutes_per_team;
