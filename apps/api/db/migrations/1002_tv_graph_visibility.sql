-- 1002_tv_graph_visibility.sql — per-person switch for the public TV networking
-- graph (#934, #935; no user story covers it).
--
-- DELTA(#934): `tv_graph_visible` is independent of `directory_visible`: it can be
-- set while profile sharing is off. Default true, so every existing person and
-- every person without a profile row is included until they opt out. The graph
-- itself is not built here; this only stores the choice.
ALTER TABLE user_public_profiles
  ADD COLUMN tv_graph_visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN user_public_profiles.tv_graph_visible IS
  '#934: show this person as a node (and their connections as edges) on the public TV graph. Default on; no row = on. Independent of directory_visible. Staff may turn it off, never on.';
