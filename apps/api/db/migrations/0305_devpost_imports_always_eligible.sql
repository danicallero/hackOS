-- DELTA(H21,H38): a project carrying a Devpost import identity
-- (devpost_import_url) is always eligible for judging. Unresolved Devpost
-- addresses, roster differences and team size remain reconciliation issues
-- for organizers, but nothing automatic excludes the import from queues. An
-- explicit organizer eligibility_override still wins; a reconciled-away
-- source loses its import identity and keeps its override=false.
-- DROP/CREATE: r.* re-expands to the current repos columns, which CREATE OR
-- REPLACE cannot insert mid-list. Nothing else depends on this view.
DROP VIEW project_reconciliation_state;
CREATE VIEW project_reconciliation_state AS
WITH rosters AS (
  SELECT r.*,
    ARRAY(SELECT DISTINCT user_id FROM (
      SELECT m.user_id FROM planned_work_groups g JOIN planned_work_group_members m ON m.group_id=g.id AND m.status='active' WHERE g.linked_repo_id=r.id
      UNION SELECT s.user_id FROM submissions s WHERE s.repo_id=r.id AND s.status='active' AND s.imported_from <> 'devpost'
    ) people ORDER BY user_id) AS internal_ids,
    ARRAY(SELECT DISTINCT dp.user_id FROM devpost_participants dp WHERE dp.repo_id=r.id AND dp.user_id IS NOT NULL ORDER BY dp.user_id) AS external_ids,
    (SELECT count(*)::int FROM devpost_participants dp WHERE dp.repo_id=r.id AND dp.user_id IS NULL) AS unresolved_count,
    EXISTS(SELECT 1 FROM devpost_participants dp WHERE dp.repo_id=r.id) AS has_external_roster,
    EXISTS(SELECT 1 FROM planned_work_groups g WHERE g.linked_repo_id=r.id)
      OR EXISTS(SELECT 1 FROM submissions s WHERE s.repo_id=r.id AND s.imported_from <> 'devpost' AND s.status='active') AS has_internal_roster
  FROM repos r
), issues AS (
 SELECT rosters.*,
   has_internal_roster AND has_external_roster AND (internal_ids <> external_ids OR unresolved_count>0) AS membership_differs,
   CASE WHEN membership_resolution='internal' OR (NOT has_external_roster AND has_internal_roster)
     THEN cardinality(internal_ids)
     ELSE cardinality(external_ids)+unresolved_count END AS participant_count,
   (SELECT project_max_team_size FROM event_config WHERE id=1) AS max_team_size
 FROM rosters
)
SELECT issues.*,
  max_team_size IS NOT NULL AND participant_count>max_team_size AND NOT team_size_exception AS team_size_violation,
  COALESCE(eligibility_override,
    devpost_import_url IS NOT NULL
    OR (submission_status='submitted'
      AND NOT (membership_differs AND membership_resolution IS NULL)
      AND NOT (unresolved_count>0 AND membership_resolution IS DISTINCT FROM 'internal')
      AND (max_team_size IS NULL OR participant_count<=max_team_size OR team_size_exception))
  ) AS eligible
FROM issues;
