-- DELTA(#852, #854): planned groups keep project-like metadata before an exact Devpost import links them.
ALTER TABLE planned_work_groups
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN github_url text,
  ADD COLUMN demo_url text;

COMMENT ON COLUMN planned_work_groups.linked_repo_id IS
  'Exact Devpost URL linkage only (#854); planning metadata never creates queue entries.';
