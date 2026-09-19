-- 0802_drop_permission_groups.sql — DELTA(H8): the capability-group DAG is
-- no longer part of authorization resolution (0800/0801 moved every group's
-- effective capability set onto the new role hierarchy). Drop the group
-- tables now that the copy has landed in the same change.
--
-- capability_grant_quarantine is left in place: it's a standalone historical
-- repair-queue record (0104) with no FK to permission_groups, unaffected by
-- this drop.

DROP VIEW IF EXISTS deprecated_sponsor_portal_assignments;
DROP TABLE permission_group_includes;
DROP TABLE permission_group_members;
DROP TABLE group_capabilities;
DROP TABLE permission_groups;
