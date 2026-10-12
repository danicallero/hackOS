-- DELTA(H6,H16-H21,H30,H53): keep planning, membership and repo IDs;
-- explicit submission lifecycle and auditable organizer exceptions.
ALTER TABLE event_config ADD COLUMN project_max_team_size integer CHECK (project_max_team_size > 0);
ALTER TABLE planned_work_groups ADD COLUMN reconciliation_code text;
ALTER TABLE repos ADD COLUMN reconciliation_code text;
CREATE FUNCTION new_project_reconciliation_code() RETURNS text LANGUAGE plpgsql AS $$
DECLARE candidate text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('project_reconciliation_codes',0));
  LOOP
    candidate := upper(encode(gen_random_bytes(4),'hex'));
    IF NOT EXISTS (SELECT 1 FROM repos WHERE reconciliation_code=candidate)
       AND NOT EXISTS (SELECT 1 FROM planned_work_groups WHERE reconciliation_code=candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
END $$;
UPDATE repos SET reconciliation_code=new_project_reconciliation_code();
UPDATE planned_work_groups g SET reconciliation_code=COALESCE(
  (SELECT r.reconciliation_code FROM repos r WHERE r.id=g.linked_repo_id),new_project_reconciliation_code());
ALTER TABLE repos ALTER COLUMN reconciliation_code SET DEFAULT new_project_reconciliation_code(), ALTER COLUMN reconciliation_code SET NOT NULL;
ALTER TABLE planned_work_groups ALTER COLUMN reconciliation_code SET DEFAULT new_project_reconciliation_code(), ALTER COLUMN reconciliation_code SET NOT NULL;
CREATE UNIQUE INDEX repos_reconciliation_code_key ON repos(reconciliation_code);
CREATE UNIQUE INDEX planned_work_groups_reconciliation_code_key ON planned_work_groups(reconciliation_code);
CREATE FUNCTION preserve_project_reconciliation_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reconciliation_code IS DISTINCT FROM OLD.reconciliation_code THEN
    RAISE EXCEPTION 'Project reconciliation codes are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER repos_preserve_code BEFORE UPDATE ON repos FOR EACH ROW EXECUTE FUNCTION preserve_project_reconciliation_code();
CREATE TRIGGER planned_work_groups_preserve_code BEFORE UPDATE ON planned_work_groups FOR EACH ROW EXECUTE FUNCTION preserve_project_reconciliation_code();
ALTER TABLE repos
  ADD COLUMN submission_status text NOT NULL DEFAULT 'submitted' CHECK (submission_status IN ('draft','submitted','not_submitted')),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN submitted_via text DEFAULT 'devpost' CHECK (submitted_via IN ('native','devpost','admin')),
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN lock_reason text CHECK (lock_reason IN ('native_submission','devpost_deadline_import','organizer_lock')),
  ADD COLUMN eligibility_override boolean,
  ADD COLUMN team_size_exception boolean NOT NULL DEFAULT false,
  ADD COLUMN imported_project_code text,
  ADD COLUMN membership_resolution text CHECK (membership_resolution IN ('internal','devpost'));
-- Existing operational records were already judging entrants. Preserve that
-- fact without retroactively locking participants or inventing a submit actor.
UPDATE repos SET submission_status='submitted', submitted_at=created_at,
  submitted_via=CASE WHEN source='native' THEN 'native' ELSE 'devpost' END;
CREATE TABLE project_submission_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_id integer NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  actor_id integer REFERENCES users(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('native','devpost','admin')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_edit_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_id integer NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  requested_by integer REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  decided_by integer REFERENCES users(id) ON DELETE SET NULL,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE UNIQUE INDEX project_edit_requests_one_pending ON project_edit_requests(repo_id) WHERE status='pending';

-- One read model drives admin decisions and judging eligibility. Unknown
-- external addresses count once each; two verified aliases count once by ID.
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
    submission_status='submitted'
    AND NOT (membership_differs AND membership_resolution IS NULL)
    AND NOT (unresolved_count>0 AND membership_resolution IS DISTINCT FROM 'internal')
    AND (max_team_size IS NULL OR participant_count<=max_team_size OR team_size_exception)
  ) AS eligible
FROM issues;
-- DELTA(H32,H38,H39): editable track target, preparation allowance, observed cycles.
ALTER TABLE challenges ADD COLUMN target_seconds_per_team integer CHECK(target_seconds_per_team BETWEEN 30 AND 7200);
-- Existing room goals become one shared track goal; choose the strictest
-- serving-room value when historical rooms disagreed. Unserved tracks keep
-- the standard eight-minute prior until an organizer or judge sets a target.
UPDATE challenges c SET target_seconds_per_team=legacy.seconds
FROM (
 SELECT qgc.challenge_id,LEAST(7200,GREATEST(30,min(rqs.desired_minutes_per_team)*60))::integer AS seconds
 FROM queue_group_challenges qgc JOIN room_queue_groups rqg ON rqg.queue_group_id=qgc.queue_group_id
 JOIN room_queue_state rqs ON rqs.room_id=rqg.room_id GROUP BY qgc.challenge_id
) legacy WHERE c.id=legacy.challenge_id;
ALTER TABLE challenges ADD COLUMN preparation_seconds integer NOT NULL DEFAULT 120 CHECK(preparation_seconds BETWEEN 0 AND 1800);
ALTER TABLE queue_entries ADD COLUMN room_entered_at timestamptz;
UPDATE queue_entries qe SET room_entered_at=(SELECT max(qh.created_at) FROM queue_history qh WHERE qh.queue_entry_id=qe.id AND qh.new_status='in_room' AND qh.created_at<=qe.presentation_started_at) WHERE qe.presentation_started_at IS NOT NULL;

-- Shared queue uses its strictest configured track target. A five-team prior
-- avoids overreacting to the first demo. Only the most recent 20 clean completed
-- cycles are used; breaks/no-shows/negative intervals never train the estimate.
CREATE FUNCTION queue_group_timing(group_id integer) RETURNS TABLE(
 target_minutes numeric, preparation_minutes numeric, sample_count bigint,
 observed_presentation_minutes numeric, observed_preparation_minutes numeric,
 estimated_cycle_minutes numeric) LANGUAGE sql STABLE AS $$
WITH settings AS (
 SELECT COALESCE(min(c.target_seconds_per_team)/60.0,
   8) AS target,
   COALESCE(max(c.preparation_seconds)/60.0,2) AS preparation
 FROM queue_group_challenges qgc JOIN challenges c ON c.id=qgc.challenge_id WHERE qgc.queue_group_id=group_id
), samples AS (
 SELECT DISTINCT ON(qe.repo_id,qe.completed_at) qe.repo_id,qe.completed_at,
   EXTRACT(EPOCH FROM(qe.completed_at-qe.presentation_started_at))/60 AS presentation,
   CASE WHEN COALESCE(qe.room_entered_at,qe.called_at)<=qe.presentation_started_at
     AND qe.presentation_started_at-COALESCE(qe.room_entered_at,qe.called_at) <= interval '30 minutes'
     THEN EXTRACT(EPOCH FROM(qe.presentation_started_at-COALESCE(qe.room_entered_at,qe.called_at)))/60 END AS preparation
 FROM queue_entries qe JOIN queue_group_challenges qgc ON qgc.challenge_id=qe.challenge_id
 WHERE qgc.queue_group_id=group_id AND qe.status='completed'
   AND qe.completed_at>qe.presentation_started_at
   AND qe.completed_at-qe.presentation_started_at<=interval '2 hours'
 ORDER BY qe.repo_id,qe.completed_at DESC
), recent AS (SELECT * FROM samples ORDER BY completed_at DESC LIMIT 20), learned AS (
 SELECT count(*) AS n,avg(presentation) AS presentation,count(preparation) AS prep_n,avg(preparation) AS preparation FROM recent
)
SELECT s.target,s.preparation,l.n,l.presentation,l.preparation,
 (5*s.target+l.n*COALESCE(l.presentation,s.target))/(5+l.n)
 +(5*s.preparation+l.prep_n*COALESCE(l.preparation,s.preparation))/(5+l.prep_n)
FROM settings s CROSS JOIN learned l;
$$;

CREATE TABLE project_claim_decisions (
  repo_id integer NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('confirmed','rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(repo_id,user_id)
);

-- H16: exported identity stays stable when display URLs/titles are edited.
ALTER TABLE repos ADD COLUMN devpost_import_url text;
ALTER TABLE repos ADD COLUMN reconciled_into_repo_id integer REFERENCES repos(id) ON DELETE SET NULL;
UPDATE repos SET devpost_import_url=devpost_url WHERE devpost_url IS NOT NULL;
CREATE UNIQUE INDEX repos_devpost_import_url_key ON repos(devpost_import_url) WHERE devpost_import_url IS NOT NULL;

-- H6: old automatic primary links are evidence only while the address is verified.
UPDATE devpost_participants dp SET user_id=NULL,merge_status='unmatched',linked_by=NULL,linked_at=NULL
FROM users u WHERE dp.user_id=u.id AND dp.merge_status='auto_matched'
  AND NOT ((u.email_verified AND lower(dp.email)=lower(u.email))
    OR (u.secondary_email_verified_at IS NOT NULL AND lower(dp.email)=lower(u.secondary_email)));
DELETE FROM submissions s WHERE s.imported_from='devpost' AND NOT EXISTS(
  SELECT 1 FROM devpost_participants dp WHERE dp.repo_id=s.repo_id AND dp.user_id=s.user_id
);
