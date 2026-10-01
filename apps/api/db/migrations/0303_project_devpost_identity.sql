-- DELTA(H16,H19,H20): public and event Devpost URLs share a resolved identity.
ALTER TABLE repos ADD COLUMN devpost_canonical_url text;
ALTER TABLE planned_work_groups ADD COLUMN devpost_canonical_url text;
ALTER TABLE repos ADD COLUMN presentation_timing_preference text NOT NULL DEFAULT 'no_preference'
  CHECK (presentation_timing_preference IN ('no_preference', 'early', 'middle', 'late'));
UPDATE repos r SET presentation_timing_preference = g.presentation_timing_preference
FROM planned_work_groups g WHERE g.linked_repo_id = r.id;
