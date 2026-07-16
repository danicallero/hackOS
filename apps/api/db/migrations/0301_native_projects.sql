-- 0301_native_projects.sql — native project lifecycle (H18-H19).

-- DELTA(H18): the schema sketch assumed every repo arrives via Devpost
-- import. Native creation needs to distinguish origin (so re-imports never
-- clobber hand-made projects' metadata by name-dedupe) and record who
-- created the project.
ALTER TABLE repos
  ADD COLUMN source text NOT NULL DEFAULT 'devpost'
    CHECK (source IN ('devpost', 'native')),
  ADD COLUMN created_by integer REFERENCES users(id) ON DELETE SET NULL;

-- DELTA(H19): event-level policy switch — participants may create their own
-- project only while this is enabled. Off by default: Devpost-driven events
-- keep the current behaviour without touching anything.
ALTER TABLE event_config
  ADD COLUMN participants_can_create_projects boolean NOT NULL DEFAULT false;
