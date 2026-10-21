-- 0310_content_reports.sql — attendee reports of user-generated content
-- (project pages and public profiles) for organiser review.
--
-- DELTA(H18): plan/schema-boceto.dbml has no moderation inbox. A report names
-- exactly one project or one person, a fixed reason and optional text. Nothing
-- of the reported content is copied: staff read it live, so content that was
-- already hidden or edited does not linger here.
--
-- H54: both user references cascade on delete; the removal scrub
-- (identity/removal.ts) deletes the rows on either side explicitly, and the
-- H54 trigger rejects new reports by or about a pending/anonymized account.
CREATE TABLE content_reports (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id integer REFERENCES repos(id) ON DELETE CASCADE,
  target_user_id integer REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('inappropriate', 'harassment', 'spam', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolved_by integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_one_target CHECK ((repo_id IS NULL) <> (target_user_id IS NULL)),
  CONSTRAINT content_reports_not_self CHECK (target_user_id IS DISTINCT FROM reporter_id),
  CONSTRAINT content_reports_resolution CHECK ((status = 'open') = (resolved_at IS NULL))
);

-- One open report per reporter and target: reporting again is a no-op.
CREATE UNIQUE INDEX content_reports_open_project
  ON content_reports (reporter_id, repo_id) WHERE repo_id IS NOT NULL AND status = 'open';
CREATE UNIQUE INDEX content_reports_open_person
  ON content_reports (reporter_id, target_user_id)
  WHERE target_user_id IS NOT NULL AND status = 'open';
CREATE INDEX content_reports_status_created ON content_reports (status, created_at DESC);
CREATE INDEX content_reports_reporter ON content_reports (reporter_id);
CREATE INDEX content_reports_target_user ON content_reports (target_user_id)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX content_reports_repo ON content_reports (repo_id) WHERE repo_id IS NOT NULL;

CREATE TRIGGER content_reports_set_updated_at
  BEFORE UPDATE ON content_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER h54_active_user_reporter_id
  BEFORE INSERT ON content_reports
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('reporter_id');

CREATE TRIGGER h54_active_user_target_user_id
  BEFORE INSERT ON content_reports
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('target_user_id');

COMMENT ON TABLE content_reports IS 'H18 attendee reports of a project or public profile for organiser review; content is read live, never copied.';
COMMENT ON COLUMN content_reports.details IS 'H18: optional free text from the reporter, at most 500 characters; visible to moderating staff only.';
