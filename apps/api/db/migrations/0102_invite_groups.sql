-- Pre-assigned capability groups for invitations (H8/H10).
-- DELTA(H8/H10) vs plan/schema-boceto.dbml: an admin can attach permission
-- groups to an invite (POST /api/invites {groupIds}); when the invitee accepts,
-- they are added to each of these permission_groups automatically, so an
-- operator can be onboarded already holding e.g. the "event operations" group.
-- Bare integer[] (no FK): a group deleted before acceptance simply drops out,
-- mirroring users.food_intolerances' deliberate no-FK design.

ALTER TABLE email_verification_tokens
  ADD COLUMN group_ids integer[] NOT NULL DEFAULT '{}';
