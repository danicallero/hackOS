-- 0508_attendee_ticket_roles.sql — DELTA(H15,H22,H8): entrance tickets cover
-- every attendee relationship, not just confirmed participant applications.

WITH RECURSIVE effective_groups(user_id, group_id) AS (
  SELECT user_id, group_id FROM permission_group_members
  UNION
  SELECT eg.user_id, pgi.child_group_id
    FROM effective_groups eg
    JOIN permission_group_includes pgi ON pgi.parent_group_id = eg.group_id
), eligible_users AS (
  -- Staff, including admins: effective capability holders.
  SELECT DISTINCT eg.user_id
    FROM effective_groups eg
    JOIN group_capabilities gc ON gc.group_id = eg.group_id
  UNION
  -- Sponsor representatives, including manually affiliated representatives.
  SELECT user_id FROM sponsors WHERE user_id IS NOT NULL
  UNION
  -- Mentors attend once their acceptance has been communicated.
  SELECT ar.user_id
    FROM application_responses ar
    JOIN applications a ON a.id = ar.application_id
   WHERE a.type = 'mentor' AND ar.status IN ('accepted', 'confirmed')
)
INSERT INTO tickets (user_id, token)
SELECT user_id,
       md5(random()::text || clock_timestamp()::text || user_id::text)
       || md5(random()::text || clock_timestamp()::text || user_id::text)
  FROM eligible_users
ON CONFLICT (user_id) DO NOTHING;
