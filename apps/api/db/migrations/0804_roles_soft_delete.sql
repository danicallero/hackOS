-- 0804_roles_soft_delete.sql — DELTA(H8): roles gain soft-delete/restore
-- instead of hard DELETE. A deleted role's row, its role_capabilities, its
-- user_roles memberships, its application_grants_roles rows, and every
-- audit_log entry that references it all stay intact — only `deleted_at`
-- flips — so restore is a pure metadata change and nothing has to be
-- re-created. This also sidesteps the implicit RESTRICT that
-- application_grants_roles.role_id -> roles(id) (0800) would otherwise put on
-- hard-deleting an in-use default role: soft delete never touches that FK at
-- all, and roles are never hard-deleted through the API anyway (routes/roles.ts's
-- DELETE only removes a user_roles membership, never a roles row).
--
-- A deleted role must stop granting access immediately, exactly as if the
-- user held no such role: user_effective_capabilities (0800) is redefined
-- here to exclude it, and every hand-rolled resolution query in
-- role-authority.ts gains the same `r.deleted_at IS NULL` filter (code
-- change, not a migration).

ALTER TABLE roles ADD COLUMN deleted_at timestamptz;

COMMENT ON COLUMN roles.deleted_at IS
  'H8: soft-delete marker. Non-null excludes the role from capability resolution (user_effective_capabilities), from default GET /api/roles listings, and from every "highest role" / wildcard-holder computation, as if the user held no such role. A deleted role''s position becomes available for reuse (see roles_position_idx below); POST .../restore 409s only if a still-live role has since taken that exact slot.';

-- 0800's roles_position_idx was a plain UNIQUE index over every row, which
-- would keep a deleted role's position permanently reserved (a live role
-- could never reuse it, and restore's "position already taken" case could
-- never actually happen). Replace it with a partial unique index so only
-- non-deleted roles compete for a position; deleted roles can share a
-- position with each other or with a live role that took it after the fact.
DROP INDEX roles_position_idx;
CREATE UNIQUE INDEX roles_position_idx ON roles (position) WHERE deleted_at IS NULL;

COMMENT ON COLUMN roles.is_protected IS
  'H8: the real, enforced lockout — every HTTP mutation route (rename/reorder/capability-edit/delete/restore/assign/unassign) refuses a role with is_protected = true outright, unconditional on the actor''s own capabilities (role-authority.ts assertNotProtectedRole). Never settable via POST/PATCH /api/roles; only ever flipped by direct DB/CLI action. Only system:superadmin carries it as of this migration (0801''s "Platform administrator" template row was corrected to false — every default role stays deletable/editable like any other role), but any future role given this flag gets the identical lockout automatically.';

CREATE OR REPLACE VIEW user_effective_capabilities AS
SELECT user_id, capability
  FROM (
    SELECT DISTINCT ON (ur.user_id, rc.capability)
           ur.user_id, rc.capability, rc.state
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN role_capabilities rc ON rc.role_id = r.id
     WHERE rc.state <> 'inherit' AND r.deleted_at IS NULL
     ORDER BY ur.user_id, rc.capability, r.position DESC
  ) resolved
 WHERE state = 'allow';

-- H8 full-replacement: same soft-delete fix as user_effective_capabilities
-- above, applied to user_effective_badge_category (0800), which couldn't
-- filter deleted_at itself since the column didn't exist yet at that point.
CREATE OR REPLACE VIEW user_effective_badge_category AS
SELECT DISTINCT ON (ur.user_id)
       ur.user_id, r.badge_category, r.name AS role_name
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
 WHERE r.is_visible = true AND r.deleted_at IS NULL
 ORDER BY ur.user_id, r.position DESC;
