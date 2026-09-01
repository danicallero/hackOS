-- 0811_invite_role_ids_rename.sql — DELTA(H8): the deferred pre-assignment
-- columns on email_verification_tokens and user_invite_links were kept under
-- the `group_ids` name through the H8 cutover for API/client compatibility
-- (see 0803's migration comment) even though they've held `roles.id` values,
-- never `permission_groups.id`, since 0800. This branch hasn't merged or
-- deployed, so there's no live client depending on the old field name — do
-- the real rename instead of carrying the stale name forward indefinitely.

ALTER TABLE email_verification_tokens RENAME COLUMN group_ids TO role_ids;
ALTER TABLE user_invite_links RENAME COLUMN group_ids TO role_ids;

COMMENT ON COLUMN email_verification_tokens.role_ids IS
  'H8/H10: role ids (roles.id) pre-assigned on invite acceptance via user_roles.';

COMMENT ON COLUMN user_invite_links.role_ids IS
  'H8/H10: role ids (roles.id) pre-assigned on link redemption via user_roles.';
