-- DELTA(H18): events may require a linked GitHub repository (App link or a
-- repository URL set by staff) before a project can be submitted.
ALTER TABLE event_config
  ADD COLUMN project_github_required boolean NOT NULL DEFAULT false;
