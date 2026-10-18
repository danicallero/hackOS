-- 0707_enterprise_kind.sql — separate sponsors from collaborators (H43, H45).
--
-- DELTA(H45): plan/schema-boceto.dbml has a single enterprise list ordered by
-- `priority`. `kind` only labels an enterprise so the public feed can be
-- filtered (`?kind=`); it never changes the order. `priority` is the single
-- tier key (1 = first tier, e.g. root/admin/user/collaborators) and `position`
-- is the manual order inside one priority; NULL falls back to creation order.
ALTER TABLE enterprises
  ADD COLUMN kind text NOT NULL DEFAULT 'sponsor',
  ADD COLUMN position integer,
  ADD CONSTRAINT enterprises_kind_check CHECK (kind IN ('sponsor', 'collaborator'));

COMMENT ON COLUMN enterprises.kind IS 'H45: label for the optional public ?kind= filter; does not affect ordering.';
COMMENT ON COLUMN enterprises.position IS 'H45: manual order within one priority; NULL sorts by creation order after positioned rows.';
