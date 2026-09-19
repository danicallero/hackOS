-- 0101_better_auth.sql — Better Auth session/account/verification tables
-- (identity workstream, H1-H10).
--
-- Better Auth's "user" model is NOT redefined here: it is configured to
-- point straight at the existing `users` table from 0001_initial.sql
-- (src/modules/identity/auth.ts sets user.modelName = "users" with
-- camelCase -> snake_case `fields` mapping). Only the three tables Better
-- Auth needs that don't already exist — sessions, accounts, verifications —
-- are hand-written here, snake_case, matching the identity module's Better
-- Auth config field-for-field.
--
-- DELTA(H1,H4,H5): the boceto had no session/account/verification tables at
-- all (auth was out of scope there); these three are new, sized/typed to
-- match Better Auth 1.6's default schema (see
-- node_modules/better-auth/dist -> @better-auth/core db/schema/*).
--
-- `email_verification_tokens` (0001) is intentionally untouched: it is a
-- separate, hand-rolled token table for flows Better Auth doesn't cover
-- (secondary email H6, account claim H10/H17, sponsor invite H9/H43, spot
-- confirmation H15). Better Auth's own `verifications` table below only
-- backs its built-in primary-email-verification and password-reset flows.

-- ── sessions (H4) ────────────────────────────────────────────────────────

CREATE TABLE sessions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id ON sessions (user_id);

CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── accounts (credential provider — password hash lives here, H1) ────────

CREATE TABLE accounts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL, -- for provider_id='credential' this is the user id as text
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text, -- scrypt hash for provider_id='credential'; null for social providers
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX accounts_user_id ON accounts (user_id);

CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── verifications (Better Auth's own email-verify / password-reset tokens,
--    H2/H5) ─────────────────────────────────────────────────────────────

CREATE TABLE verifications (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier ON verifications (identifier);

CREATE TRIGGER verifications_updated_at BEFORE UPDATE ON verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── invitation kind (H9, H10) ──────────────────────────────────────────────
-- DELTA(H10): 0001's `email_verification_tokens.type` enum tells us WHICH
-- flow a token belongs to (account_claim vs sponsor_invite) but not what
-- kind of account an 'account_claim' token creates. H10 needs that
-- distinction to know which extra profile fields to require at acceptance
-- (participants/mentors need shirt size + food intolerances; staff doesn't).
-- sponsor_invite rows always imply kind='sponsor' (redundant with
-- enterprise_id being set, kept for symmetry/simpler queries).
ALTER TABLE email_verification_tokens ADD COLUMN kind text
  CHECK (kind IS NULL OR kind IN ('staff', 'sponsor', 'participant'));

