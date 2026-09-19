-- 0401_room_single_challenge.sql
-- DELTA(H46): rooms judge one challenge at a time; a challenge may still be
-- assigned to many rooms.

WITH ranked AS (
  SELECT room_id, challenge_id,
         row_number() OVER (
           PARTITION BY room_id
           ORDER BY assigned_at DESC, challenge_id DESC
         ) AS rn
    FROM room_challenges
),
discarded AS (
  DELETE FROM room_challenges rc
   USING ranked r
   WHERE rc.room_id = r.room_id
     AND rc.challenge_id = r.challenge_id
     AND r.rn > 1
   RETURNING rc.room_id, rc.challenge_id
)
DELETE FROM room_judges rj
 USING discarded d
 WHERE rj.room_id = d.room_id
   AND rj.challenge_id = d.challenge_id;

DELETE FROM room_judges rj
 WHERE NOT EXISTS (
   SELECT 1
     FROM room_challenges rc
    WHERE rc.room_id = rj.room_id
      AND rc.challenge_id = rj.challenge_id
 );

ALTER TABLE room_challenges
  ADD CONSTRAINT room_challenges_room_id_unique UNIQUE (room_id);
