-- DELTA(H50, H12): announcement delivery may target the current holders of
-- selected roles, optionally narrowed to people declaring one or more food
-- intolerances. Roles and dietary data are deliberately resolved at fan-out
-- time, so a scheduled operational notice uses the current event roster.

ALTER TABLE announcements
  ADD COLUMN role_ids integer[] NOT NULL DEFAULT '{}'::integer[],
  ADD COLUMN intolerance_ids integer[] NOT NULL DEFAULT '{}'::integer[],
  DROP COLUMN audiences;

COMMENT ON COLUMN announcements.role_ids IS
  'H50: roles whose current holders receive this announcement. Empty means no role restriction.';

COMMENT ON COLUMN announcements.intolerance_ids IS
  'H50/H12: food intolerance dictionary IDs that further narrow announcement recipients. Empty means no dietary restriction.';
