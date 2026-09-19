-- 0300_projects_devpost.sql — WS-B1 (projects/Devpost import, H16-H17)
-- schema deltas. Base tables (repos, submissions, devpost_participants,
-- devpost_prizes, repo_devpost_prizes, challenges.devpost_tags) already
-- exist from 0001_initial.sql. This migration only fills gaps discovered
-- while implementing the importer.

-- DELTA(H16): repos.devpost_url had no uniqueness constraint, but the import
-- is specified as idempotent keyed on devpost_url ("re-importing the same
-- files updates rather than duplicates"). A partial unique index (NULLs —
-- projects without a Devpost URL — are exempt, since re-import can't
-- de-duplicate those without a natural key; see module README/report for
-- that known limitation) lets confirmImport() use a plain
-- INSERT ... ON CONFLICT (devpost_url) DO UPDATE upsert.
CREATE UNIQUE INDEX repos_devpost_url_key ON repos (devpost_url) WHERE devpost_url IS NOT NULL;

-- Perf: GET /api/devpost/imports/unmatched (H17) filters on merge_status.
CREATE INDEX devpost_participants_merge_status ON devpost_participants (merge_status);
