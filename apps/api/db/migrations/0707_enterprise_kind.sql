-- 0707_enterprise_kind.sql — separate sponsors from collaborators (H43, H45).
--
-- DELTA(H45): plan/schema-boceto.dbml has a single enterprise list ordered by
-- `priority`. The public site now shows two independent groups: sponsors (the
-- logo grid, which may run challenges) and collaborators (supporting entities
-- shown apart). `priority` keeps its meaning but only orders within a group,
-- so tiers such as 1 = main sponsor, 2 = sponsors, 3 = minor collaborators
-- never interleave across groups. `position` is the manual order inside one
-- (kind, priority) group; NULL falls back to name.
ALTER TABLE enterprises
  ADD COLUMN kind text NOT NULL DEFAULT 'sponsor',
  ADD COLUMN position integer,
  ADD CONSTRAINT enterprises_kind_check CHECK (kind IN ('sponsor', 'collaborator'));

COMMENT ON COLUMN enterprises.kind IS 'H45: public group. `priority` orders only within one kind.';
COMMENT ON COLUMN enterprises.position IS 'H45: manual order within one (kind, priority) group; NULL sorts by name after positioned rows.';
