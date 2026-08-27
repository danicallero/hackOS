-- 0740_account_removal_email_pin.sql — H54 verified-email confirmation.
--
-- A verified primary email adds a one-time six-digit confirmation step to
-- self-service deletion/anonymization. The raw PIN is never stored; the
-- digest is HMACed with the deployment secret and the challenge is short-lived
-- and attempt-limited. This table is transient security state and cascades
-- with the user; it is not anonymous audit data.

CREATE TABLE account_removal_pin_challenges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  pin_digest text NOT NULL,
  nonce text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX account_removal_pin_challenges_user
  ON account_removal_pin_challenges (user_id, created_at DESC);

COMMENT ON TABLE account_removal_pin_challenges IS
  'H54 transient one-time security PIN state for verified-primary-email self-service removal; never anonymous audit data and deleted with the user.';
COMMENT ON COLUMN account_removal_pin_challenges.email IS
  'The verified primary address at issue time; used to invalidate a PIN after an address change and deleted with the challenge.';
COMMENT ON COLUMN account_removal_pin_challenges.pin_digest IS
  'HMAC digest of the six-digit PIN, user id, email and nonce; the raw PIN is never persisted.';
