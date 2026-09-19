-- DELTA(H10): reusable account-creation links are available for every invite
-- kind, not only sponsor enterprises. A link can assign capability groups to
-- staff accounts, limit redemptions, expire, or be withdrawn while keeping a
-- durable redemption history.

CREATE TABLE user_invite_links (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('staff', 'sponsor', 'participant')),
  enterprise_id integer REFERENCES enterprises(id) ON DELETE CASCADE,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  group_ids integer[] NOT NULL DEFAULT '{}',
  wildcard_authorized boolean NOT NULL DEFAULT false,
  max_redeems integer CHECK (max_redeems IS NULL OR max_redeems > 0),
  redeemed_count integer NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'sponsor' AND enterprise_id IS NOT NULL)
    OR (kind <> 'sponsor' AND enterprise_id IS NULL)
  ),
  CHECK (kind = 'staff' OR group_ids = '{}')
);

CREATE INDEX user_invite_links_created_at
  ON user_invite_links (created_at DESC);

COMMENT ON COLUMN user_invite_links.wildcard_authorized IS
  'Durable proof that a wildcard holder authorized this deferred group grant.';

CREATE TRIGGER user_invite_links_updated_at
  BEFORE UPDATE ON user_invite_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_invite_link_redemptions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id integer NOT NULL REFERENCES user_invite_links(id) ON DELETE CASCADE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, user_id)
);

CREATE INDEX user_invite_link_redemptions_link_id
  ON user_invite_link_redemptions (link_id, redeemed_at DESC);
