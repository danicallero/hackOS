-- 0804_roles_soft_delete.sql — DELTA(H8): roles gain soft-delete/restore
-- instead of hard DELETE. A deleted role's row, its role_capabilities, its
-- user_roles memberships, and every audit_log entry that references it all
-- stay intact — only `deleted_at` flips — so restore is a pure metadata
-- change and nothing has to be re-created. This also sidesteps the implicit
-- RESTRICT on applications.grants_role_id -> roles(id) (0800) that a hard
-- DELETE of an in-use default role would previously have hit: soft delete
-- never touches that FK at all.
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
  'H8: informational flag carried over from the original template cutover (0801). It no longer gates deletion by itself — every default role (Platform administrator included) is deletable/editable like any other role. The one role that cannot be mutated through the API at all is identified by NAME (system:superadmin), enforced in code (role-authority.ts assertNotSuperadminRole), not by this column, since is_protected may end up describing other default roles in the future without granting them the same CLI-only lockout.';

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
