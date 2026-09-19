-- DELTA(H43): reusable enterprise invitation links are separate from the
-- email-bound token flow. Each link can be limited, expire automatically, or
-- remain open-ended, while every account created through it is auditable.

CREATE TABLE enterprise_invite_links (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token text NOT NULL UNIQUE,
  enterprise_id integer NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  max_redeems integer CHECK (max_redeems IS NULL OR max_redeems > 0),
  redeemed_count integer NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enterprise_invite_links_enterprise_id
  ON enterprise_invite_links (enterprise_id, created_at DESC);

CREATE TRIGGER enterprise_invite_links_updated_at
  BEFORE UPDATE ON enterprise_invite_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE enterprise_invite_link_redemptions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id integer NOT NULL REFERENCES enterprise_invite_links(id) ON DELETE CASCADE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, user_id)
);

CREATE INDEX enterprise_invite_link_redemptions_link_id
  ON enterprise_invite_link_redemptions (link_id, redeemed_at DESC);
