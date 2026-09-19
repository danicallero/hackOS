-- 0806_superadmin_not_visible.sql — DELTA(H8): system:superadmin is CLI-only
-- provisioned state, not a role an admin should ever see picked as anyone's
-- shown "public role" (role.ts computes that as the highest-position role
-- among a user's assigned roles that is marked is_visible). The CLI scripts
-- (grant-superadmin.mjs, create-superadmin.ts) now set is_visible = false on
-- every insert/update, but any environment where the role was already
-- created by an earlier script run still has the old default (true) — fix
-- it here so this isn't just a new-install behavior.

UPDATE roles SET is_visible = false WHERE name = 'system:superadmin';
