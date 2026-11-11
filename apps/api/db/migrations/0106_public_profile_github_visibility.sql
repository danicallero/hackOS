-- 0106_public_profile_github_visibility.sql — let each member hide the linked
-- GitHub account URL from their public profile while keeping the account linked.
--
-- DELTA(#935): the profile can now independently hide its linked GitHub URL.
-- Existing rows keep the previous behavior by defaulting to visible.
ALTER TABLE user_public_profiles
  ADD COLUMN show_github boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN user_public_profiles.show_github IS
  '#935: expose the linked GitHub account URL to profile readers.';
