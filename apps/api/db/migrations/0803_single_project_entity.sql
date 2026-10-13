-- #1006, #1005 (DELTA vs plan/schema-boceto.dbml, H16-H21): one project
-- entity. `repos` stays the project table (queue, judging and winners keep
-- their repo_id references), `submissions` is its only member table, with
-- invitations, and `project_challenges` is the only record of which
-- challenges a project enters. Planned work groups, the external import
-- integration and its reconciliation model are removed. Product decision
-- (2026-10-13): no project data has to be preserved, so imported projects
-- and planning-only groups are deleted rather than converted.
--
-- Numbered after 0802 instead of in the 03xx band: it rewrites the capability
-- catalogue that 0802 last defined and depends on challenges.mandatory (0602),
-- so on a fresh database it must run after both.

-- ── Imported projects and everything that depends on them ────────────────
CREATE TEMPORARY TABLE retired_repos ON COMMIT DROP AS
  SELECT id FROM repos WHERE source <> 'native';
CREATE TEMPORARY TABLE retired_entries ON COMMIT DROP AS
  SELECT id FROM queue_entries WHERE repo_id IN (SELECT id FROM retired_repos);
DELETE FROM attempt_review_versions WHERE attempt_id IN (SELECT id FROM retired_entries);
DELETE FROM attempt_review WHERE attempt_id IN (SELECT id FROM retired_entries);
DELETE FROM judging_session WHERE queue_entry_id IN (SELECT id FROM retired_entries);
DELETE FROM queue_history WHERE queue_entry_id IN (SELECT id FROM retired_entries);
DELETE FROM queue_entries WHERE id IN (SELECT id FROM retired_entries);
DELETE FROM challenge_winners WHERE repo_id IN (SELECT id FROM retired_repos);
DELETE FROM submissions WHERE repo_id IN (SELECT id FROM retired_repos);
DELETE FROM devpost_participants WHERE repo_id IN (SELECT id FROM retired_repos);
DELETE FROM repo_devpost_prizes WHERE repo_id IN (SELECT id FROM retired_repos);
UPDATE repos SET reconciled_into_repo_id = NULL WHERE reconciled_into_repo_id IS NOT NULL;
DELETE FROM repos WHERE id IN (SELECT id FROM retired_repos);
DELETE FROM submissions WHERE imported_from <> 'manual';
DELETE FROM notification_outbox WHERE category = 'devpost';

-- ── Retired tables, view and functions ───────────────────────────────────
DROP VIEW project_reconciliation_state;
DROP TABLE project_claim_decisions;
DROP TABLE devpost_participants;
DROP TABLE repo_devpost_prizes;
DROP TABLE devpost_prizes;
DROP TABLE planned_work_group_challenges;
DROP TABLE planned_work_group_members;
DROP TABLE planned_work_groups;
DROP TRIGGER repos_preserve_code ON repos;
DROP FUNCTION preserve_project_reconciliation_code();

ALTER TABLE repos
  DROP COLUMN devpost_url,
  DROP COLUMN devpost_canonical_url,
  DROP COLUMN devpost_import_url,
  DROP COLUMN source,
  DROP COLUMN imported_project_code,
  DROP COLUMN membership_resolution,
  DROP COLUMN reconciliation_code,
  DROP COLUMN reconciled_into_repo_id;
DROP FUNCTION new_project_reconciliation_code();
ALTER TABLE challenges DROP COLUMN devpost_tags;
ALTER TABLE submissions DROP COLUMN imported_from, DROP COLUMN external_id;

-- ── Lifecycle: draft -> submitted (-> reopened draft -> submitted) ────────
ALTER TABLE repos
  DROP CONSTRAINT repos_submission_status_check,
  DROP CONSTRAINT repos_submitted_via_check,
  DROP CONSTRAINT repos_lock_reason_check;
UPDATE repos SET submission_status = 'draft' WHERE submission_status = 'not_submitted';
UPDATE repos SET submitted_via = CASE submitted_via WHEN 'native' THEN 'participant' ELSE 'admin' END
 WHERE submitted_via IS NOT NULL;
-- Submitting no longer locks a project (members edit until the window
-- closes); only an organizer lock remains.
UPDATE repos SET locked_at = NULL, lock_reason = NULL WHERE lock_reason = 'native_submission';
UPDATE repos SET lock_reason = 'organizer_lock' WHERE lock_reason IS NOT NULL;
ALTER TABLE repos
  ALTER COLUMN submission_status SET DEFAULT 'draft',
  ALTER COLUMN submitted_via DROP DEFAULT,
  ADD CONSTRAINT repos_submission_status_check CHECK (submission_status IN ('draft', 'submitted')),
  ADD CONSTRAINT repos_submitted_via_check CHECK (submitted_via IN ('participant', 'admin')),
  ADD CONSTRAINT repos_lock_reason_check CHECK (lock_reason IN ('organizer_lock'));
COMMENT ON TABLE repos IS
  'A project and its team (#1006). Participants create drafts and may edit and resubmit until the window closes; organizers can lock and reopen. Deliberately independent from application_responses.';

DELETE FROM project_submission_versions WHERE source = 'devpost';
ALTER TABLE project_submission_versions DROP CONSTRAINT project_submission_versions_source_check;
UPDATE project_submission_versions SET source = 'participant' WHERE source = 'native';
ALTER TABLE project_submission_versions
  ADD CONSTRAINT project_submission_versions_source_check CHECK (source IN ('participant', 'admin'));

-- ── One challenge-intent store ───────────────────────────────────────────
-- A project's chosen challenges. Generating a challenge's queue turns these
-- rows (plus mandatory challenges) into queue entries; once a queue exists,
-- adding or withdrawing a challenge updates it immediately (H21).
CREATE TABLE project_challenges (
  repo_id integer NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  challenge_id integer NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, challenge_id)
);
CREATE INDEX project_challenges_challenge ON project_challenges (challenge_id);
INSERT INTO project_challenges (repo_id, challenge_id)
SELECT DISTINCT repo_id, challenge_id FROM queue_entries
 WHERE status NOT IN ('cancelled', 'disqualified');

COMMENT ON COLUMN challenges.mandatory IS
  'When true, every project enters this challenge regardless of its own selection (#851).';

-- ── Judging eligibility from the single roster ───────────────────────────
CREATE VIEW project_eligibility AS
WITH counted AS (
  SELECT r.id, r.is_test_account, r.submission_status, r.eligibility_override, r.team_size_exception,
    (SELECT count(*)::int FROM submissions s JOIN users u ON u.id = s.user_id
      WHERE s.repo_id = r.id AND s.status = 'active'
        AND u.account_state = 'active' AND u.anonymized_at IS NULL) AS participant_count,
    (SELECT project_max_team_size FROM event_config WHERE id = 1) AS max_team_size
  FROM repos r
)
SELECT counted.*,
  max_team_size IS NOT NULL AND participant_count > max_team_size AND NOT team_size_exception
    AS team_size_violation,
  COALESCE(eligibility_override,
    submission_status = 'submitted'
    AND (max_team_size IS NULL OR participant_count <= max_team_size OR team_size_exception)
  ) AS eligible
FROM counted;

-- ── Retired capability ───────────────────────────────────────────────────
DELETE FROM public.role_capabilities WHERE capability = 'projects:import';
UPDATE public.role_seed_defaults
   SET capabilities = capabilities - 'projects:import'
 WHERE capabilities ? 'projects:import';
ALTER TABLE public.role_capabilities DROP CONSTRAINT role_capabilities_known_catalogue;
ALTER TABLE public.role_capabilities
  ADD CONSTRAINT role_capabilities_known_catalogue CHECK ((capability = ANY (ARRAY[
    '*'::text, 'users:read'::text, 'users:write'::text, 'permissions:manage'::text,
    'invites:manage'::text, 'applications:manage'::text, 'applications:review'::text,
    'applications:decide'::text, 'applications:confirm-override'::text,
    'applications:edit-response'::text, 'statistics:manage'::text, 'projects:read'::text,
    'projects:edit'::text, 'accredit:scan'::text,
    'presence:scan'::text, 'activity:scan'::text, 'logistics:stats'::text,
    'intolerances:manage'::text, 'meal-plans:export'::text, 'meal-plans:manage'::text,
    'queue:status'::text, 'queue:operate'::text, 'queue:admin'::text, 'judge:panel'::text,
    'judging:export'::text, 'sponsors:manage'::text, 'challenges:manage'::text,
    'schedule:read'::text, 'schedule:manage'::text, 'announcements:manage'::text,
    'tv:control'::text, 'notifications:send'::text, 'audit:read'::text, 'exports:run'::text,
    'event:manage'::text, 'venue:manage'::text, 'wallet:manage'::text,
    'presence:manage'::text])));
