-- 0510_wallet_access_tokens.sql — DELTA(H15,H28): scoped wallet-pass
-- credentials. Confirming a spot from the acceptance email (H15) hands back a
-- short-lived token whose ONLY power is "download the wallet pass of this
-- purpose for this user" (H28). It is deliberately not a session: it carries no
-- capabilities, cannot read the API, and expires on its own. Kept out of
-- `email_verification_tokens` precisely so nothing can confuse an identity
-- assertion from an email with an access credential.
CREATE TABLE wallet_access_tokens (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token text NOT NULL UNIQUE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('ticket', 'badge')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sweeping expired rows (the only non-token-keyed access pattern).
CREATE INDEX wallet_access_tokens_expires_idx ON wallet_access_tokens (expires_at);
