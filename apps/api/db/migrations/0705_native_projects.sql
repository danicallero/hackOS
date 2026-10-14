-- DELTA(H16,H17,H18,H20,H60; #1005-#1010): native projects replace the
-- external-import model against plan/schema-boceto.dbml.
--   H16/H17: one project roster (repos + submissions); planned work groups
--     merge into repos, Devpost/import/reconciliation tables and columns drop.
--   H18/H20: project_challenges holds intended challenges; project_form_versions
--     and project_submission_versions.form_version_id snapshot the native form;
--     repos.responses/draft_revision store the working draft; project_files
--     stores private uploads.
--   H60: event_config gains the project phase policy (draft/submission/gallery/
--     edit-lock windows, audience); users gain explicit gallery name/photo
--     consent; challenges gain scheduled winner publication.
--   project_eligibility is a singleton-safe view (absent team-size limit means
--     unlimited).
-- Sits in the 07xx band, after 0701 (which creates the participant
-- self-service window columns this file folds into the project phase policy
-- and drops), so it must sort after 0704. Out-of-order apply on a database that
-- already has 0801/0802 is safe: this file touches none of their objects.
DROP VIEW project_reconciliation_state;
DROP TRIGGER repos_preserve_code ON repos;
DROP TRIGGER planned_work_groups_preserve_code ON planned_work_groups;
ALTER TABLE repos ALTER COLUMN reconciliation_code DROP DEFAULT;
ALTER TABLE planned_work_groups ALTER COLUMN reconciliation_code DROP DEFAULT;
DROP FUNCTION preserve_project_reconciliation_code();
DROP FUNCTION new_project_reconciliation_code();

CREATE TABLE project_challenges (
  repo_id integer NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  challenge_id integer NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(repo_id,challenge_id)
);
INSERT INTO project_challenges(repo_id,challenge_id)
SELECT DISTINCT repo_id,challenge_id FROM queue_entries ON CONFLICT DO NOTHING;

-- Existing linked planning records merge into their stable operational ID.
INSERT INTO submissions(repo_id,user_id,status,invited_by,responded_at)
SELECT g.linked_repo_id,m.user_id,m.status,m.invited_by,m.responded_at
FROM planned_work_groups g JOIN planned_work_group_members m ON m.group_id=g.id
WHERE g.linked_repo_id IS NOT NULL AND m.status<>'declined'
ON CONFLICT(repo_id,user_id) DO UPDATE SET status=CASE
 WHEN submissions.status='active' OR excluded.status='active' THEN 'active' ELSE 'invited' END;
INSERT INTO project_challenges(repo_id,challenge_id)
SELECT g.linked_repo_id,c.challenge_id FROM planned_work_groups g
JOIN planned_work_group_challenges c ON c.group_id=g.id WHERE g.linked_repo_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Unlinked planning projects become drafts without generating queue entries.
DO $$ DECLARE g record; project_id integer; BEGIN
 FOR g IN SELECT * FROM planned_work_groups WHERE linked_repo_id IS NULL LOOP
  INSERT INTO repos(name,description,github_url,demo_url,created_by,source,submission_status,reconciliation_code,presentation_timing_preference)
  VALUES(g.name,g.description,g.github_url,g.demo_url,g.created_by,'native','draft',g.reconciliation_code,g.presentation_timing_preference)
  RETURNING id INTO project_id;
  INSERT INTO submissions(repo_id,user_id,status,invited_by,responded_at)
  SELECT project_id,user_id,status,invited_by,responded_at FROM planned_work_group_members WHERE group_id=g.id AND status<>'declined';
  INSERT INTO project_challenges(repo_id,challenge_id)
  SELECT project_id,challenge_id FROM planned_work_group_challenges WHERE group_id=g.id;
 END LOOP;
END $$;
DROP TABLE planned_work_group_challenges,planned_work_group_members,planned_work_groups;
DROP TABLE project_claim_decisions,repo_devpost_prizes,devpost_prizes,devpost_participants CASCADE;
ALTER TABLE challenges DROP COLUMN devpost_tags;
ALTER TABLE repos DROP COLUMN devpost_url,DROP COLUMN devpost_canonical_url,
 DROP COLUMN devpost_import_url,DROP COLUMN source,DROP COLUMN imported_project_code,
 DROP COLUMN membership_resolution,DROP COLUMN reconciliation_code,DROP COLUMN reconciled_into_repo_id;
ALTER TABLE repos DROP CONSTRAINT repos_submitted_via_check,DROP CONSTRAINT repos_lock_reason_check;
UPDATE repos SET submitted_via='native' WHERE submitted_via='devpost';
UPDATE repos SET lock_reason='native_submission' WHERE lock_reason='devpost_deadline_import';
ALTER TABLE repos ALTER COLUMN submitted_via SET DEFAULT 'native';
ALTER TABLE repos ADD CONSTRAINT repos_submitted_via_check CHECK(submitted_via IN('native','admin')),
 ADD CONSTRAINT repos_lock_reason_check CHECK(lock_reason IN('native_submission','organizer_lock'));
ALTER TABLE submissions DROP COLUMN imported_from,DROP COLUMN external_id,
 DROP CONSTRAINT submissions_status_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_status_check CHECK(status IN('invited','active','declined'));
ALTER TABLE project_submission_versions DROP CONSTRAINT project_submission_versions_source_check;
UPDATE project_submission_versions SET source='native' WHERE source='devpost';
ALTER TABLE project_submission_versions ADD CONSTRAINT project_submission_versions_source_check CHECK(source IN('native','admin'));
DELETE FROM role_capabilities WHERE capability='projects:import';

ALTER TABLE repos ADD COLUMN responses jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN draft_revision integer NOT NULL DEFAULT 0;
CREATE TABLE project_form_versions (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 template jsonb NOT NULL,
 sections jsonb NOT NULL DEFAULT '[]',
 created_by integer REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO project_form_versions(template) VALUES('[]');
ALTER TABLE project_submission_versions ADD COLUMN form_version_id integer REFERENCES project_form_versions(id);
ALTER TABLE event_config
 ADD COLUMN project_drafts_open_at timestamptz,
 ADD COLUMN project_submissions_close_at timestamptz,
 ADD COLUMN project_draft_visibility text NOT NULL DEFAULT 'team_only' CHECK(project_draft_visibility IN('team_only','attendees','public')),
 ADD COLUMN project_gallery_opens_at timestamptz,
 ADD COLUMN project_gallery_audience text NOT NULL DEFAULT 'staff' CHECK(project_gallery_audience IN('staff','attendees','public')),
 ADD COLUMN project_edits_lock_at timestamptz;
ALTER TABLE users ADD COLUMN gallery_show_name boolean NOT NULL DEFAULT true,
 ADD COLUMN gallery_show_photo boolean NOT NULL DEFAULT false,
 ADD COLUMN gallery_consented_at timestamptz;
ALTER TABLE challenges ADD COLUMN winners_publish_at timestamptz,
 ADD COLUMN winners_published_at timestamptz;
CREATE INDEX challenges_pending_winners_publication ON challenges(winners_publish_at)
 WHERE winners_published_at IS NULL AND winners_publish_at IS NOT NULL;
CREATE TABLE project_files (
 object_key text PRIMARY KEY,
 repo_id integer NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
 uploaded_by integer REFERENCES users(id) ON DELETE SET NULL,
 field_key text NOT NULL,
 filename text NOT NULL,
 mime_type text NOT NULL,
 size_bytes integer NOT NULL,
 thumbnail_key text,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- DELTA(H21,H30,#1006): eligibility must not disappear when the event singleton
-- is unconfigured.
CREATE VIEW project_eligibility AS
SELECT r.id AS repo_id,r.submission_status='submitted'
 AND r.eligibility_override IS DISTINCT FROM false
 AND (r.team_size_exception OR (SELECT project_max_team_size FROM event_config WHERE id=1) IS NULL OR
 (SELECT count(*) FROM submissions s WHERE s.repo_id=r.id AND s.status='active') <=
 (SELECT project_max_team_size FROM event_config WHERE id=1)) AS eligible
FROM repos r;

UPDATE role_seed_defaults SET capabilities=capabilities-'projects:import'
 WHERE capabilities ? 'projects:import';
UPDATE event_config SET project_drafts_open_at=COALESCE(project_drafts_open_at,participant_self_service_starts_at),
 project_submissions_close_at=COALESCE(project_submissions_close_at,participant_self_service_ends_at);
ALTER TABLE event_config DROP COLUMN participants_can_create_projects,
 DROP COLUMN participant_self_service_starts_at,DROP COLUMN participant_self_service_ends_at;
