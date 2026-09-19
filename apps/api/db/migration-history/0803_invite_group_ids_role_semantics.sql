-- 0803_invite_group_ids_role_semantics.sql — DELTA(H8, H10): the deferred
-- pre-assignment columns kept their `group_ids`/kind name (API compatibility
-- — no client-facing rename) but now store `roles.id` values, applied to
-- `user_roles` on acceptance instead of `permission_group_members`. No
-- column type change is needed (integer[], never FK-enforced, exactly as
-- food_intolerances references food_intolerances rows without a DB FK) —
-- this migration only documents the repoint at the schema level.

COMMENT ON COLUMN email_verification_tokens.group_ids IS
  'H8/H10: role ids (roles.id) pre-assigned on invite acceptance via user_roles. Named group_ids for API/client compatibility; no longer permission_groups ids.';

COMMENT ON COLUMN user_invite_links.group_ids IS
  'H8/H10: role ids (roles.id) pre-assigned on link redemption via user_roles. Named group_ids for API/client compatibility; no longer permission_groups ids.';
