-- 0101_public_profile.sql — #934 opt-in people directory (shared base for #935).
--
-- DELTA(#934): plan/schema-boceto.dbml has no public profile or directory
-- consent. New table 1:1 with users; identity data (name, surname, image)
-- stays in users and is projected, never duplicated. #935 (NFC contact card)
-- extends this table instead of creating a second profile.
--
-- Absence of a row means "not visible": no backfill is needed. ON DELETE
-- CASCADE covers H54 deletion; H54 anonymization deletes the row explicitly
-- (identity/removal.ts) and the H54 trigger rejects writes for pending or
-- anonymized accounts.
CREATE TABLE user_public_profiles (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  directory_visible boolean NOT NULL DEFAULT false,
  show_surname boolean NOT NULL DEFAULT false,
  show_photo boolean NOT NULL DEFAULT false,
  show_project boolean NOT NULL DEFAULT true,
  headline text CHECK (headline IS NULL OR char_length(headline) <= 80),
  location_note text CHECK (location_note IS NULL OR char_length(location_note) <= 60),
  consented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upp_consent_when_visible CHECK (NOT directory_visible OR consented_at IS NOT NULL)
);

CREATE TRIGGER user_public_profiles_set_updated_at
  BEFORE UPDATE ON user_public_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER h54_active_user_user_id
  BEFORE INSERT OR UPDATE ON user_public_profiles
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('user_id');

CREATE INDEX user_public_profiles_visible ON user_public_profiles (user_id) WHERE directory_visible;

COMMENT ON TABLE user_public_profiles IS '#934 directory opt-in and public fields; #935 extends it. Absence of a row = not visible.';
COMMENT ON COLUMN user_public_profiles.consented_at IS '#934: last transition of directory_visible from false to true.';

-- #934 D3: directory:read for participants, mentors and staff; not Sponsor
-- or Judging Team by default. `*` already covers admins.
ALTER TABLE role_capabilities DROP CONSTRAINT role_capabilities_known_catalogue;
ALTER TABLE role_capabilities ADD CONSTRAINT role_capabilities_known_catalogue CHECK (
  capability = ANY (ARRAY[
    '*', 'users:read', 'users:write', 'permissions:manage', 'invites:manage',
    'applications:manage', 'applications:review', 'applications:decide',
    'applications:confirm-override', 'applications:edit-response', 'statistics:manage',
    'projects:read', 'projects:import', 'projects:edit', 'accredit:scan', 'presence:scan',
    'activity:scan', 'logistics:stats', 'intolerances:manage', 'queue:status',
    'queue:operate', 'queue:admin', 'judge:panel', 'judging:export', 'sponsors:manage',
    'challenges:manage', 'schedule:manage', 'announcements:manage', 'tv:control',
    'notifications:send', 'audit:read', 'exports:run', 'event:manage', 'venue:manage',
    'wallet:manage', 'presence:manage', 'directory:read'
  ]::text[])
);

INSERT INTO role_capabilities (role_id, capability, state)
SELECT r.id, 'directory:read', 'allow'::permission_state
  FROM roles r
 WHERE r.is_seeded
   AND r.deleted_at IS NULL
   AND r.name NOT IN ('Sponsor', 'Judging Team')
ON CONFLICT (role_id, capability) DO NOTHING;

-- Seeded-role reset must keep the new default instead of treating it as drift.
UPDATE role_seed_defaults rsd
   SET capabilities = rsd.capabilities || jsonb_build_object('directory:read', 'allow')
  FROM roles r
 WHERE r.id = rsd.role_id
   AND r.is_seeded
   AND r.deleted_at IS NULL
   AND r.name NOT IN ('Sponsor', 'Judging Team');
