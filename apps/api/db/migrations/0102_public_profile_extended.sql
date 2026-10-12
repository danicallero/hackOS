-- 0102_public_profile_extended.sql — account photo in private storage, plus
-- bio, social links and an opt-in CV on the public profile (#934, #935).
--
-- DELTA(#934): plan/schema-boceto.dbml's users.image is an arbitrary URL. The
-- account photo is now uploaded by its owner to PRIVATE object storage under
-- profiles/<user id>/photo/ and served only through the authenticated
-- GET /api/users/:id/photo. users.photo_key holds the object key; users.image
-- is no longer read or written by hackOS. H54 removal deletes the whole
-- profiles/<user id>/ prefix and the key disappears with the users row (or
-- is cleared by a review-fixture reset).
ALTER TABLE users
  ADD COLUMN photo_key text,
  ADD COLUMN photo_updated_at timestamptz,
  ADD CONSTRAINT users_photo_key_owned CHECK (
    photo_key IS NULL OR photo_key ~ ('^profiles/' || id || '/photo/[0-9a-f]{32}\.(png|jpg|webp)$')
  ),
  ADD CONSTRAINT users_photo_complete CHECK ((photo_key IS NULL) = (photo_updated_at IS NULL));

COMMENT ON COLUMN users.photo_key IS '#934: private object key of the account photo (profiles/<id>/photo/…); never a public URL.';

-- DELTA(#935): the public profile gains a short bio, up to six social links
-- ({kind, url}, https only, normalized by the API) and an explicitly shared
-- CV. The CV is a profile-owned PDF under profiles/<user id>/cv/, not an
-- application file: application file fields are form-defined (no canonical
-- "CV" field) and their H56 consent covers sponsors, not directory readers.
-- share_cv exposes it only while the profile is visible in the directory.
ALTER TABLE user_public_profiles
  ADD COLUMN bio text CHECK (bio IS NULL OR char_length(bio) <= 500),
  ADD COLUMN socials jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(socials) = 'array' AND jsonb_array_length(socials) <= 6),
  ADD COLUMN share_cv boolean NOT NULL DEFAULT false,
  ADD COLUMN cv_key text,
  ADD COLUMN cv_filename text CHECK (cv_filename IS NULL OR char_length(cv_filename) <= 120),
  ADD COLUMN cv_uploaded_at timestamptz,
  ADD CONSTRAINT upp_cv_key_owned CHECK (
    cv_key IS NULL OR cv_key ~ ('^profiles/' || user_id || '/cv/[0-9a-f]{32}\.pdf$')
  ),
  ADD CONSTRAINT upp_cv_file_complete CHECK (
    (cv_key IS NULL) = (cv_filename IS NULL) AND (cv_key IS NULL) = (cv_uploaded_at IS NULL)
  );

COMMENT ON COLUMN user_public_profiles.socials IS '#935: [{kind, url}] — kind in linkedin|github|x|instagram|website|other, url https.';
COMMENT ON COLUMN user_public_profiles.share_cv IS '#935: readers may download cv_key only while this and directory_visible are true.';
