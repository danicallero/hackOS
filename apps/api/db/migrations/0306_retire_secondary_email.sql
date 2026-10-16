-- DELTA(#1016): H6 was retired with the Devpost matching rationale. Remove
-- its user fields, token type, and pending verification messages. Keep email
-- history for H54 cleanup, but capture primary-email changes only.

DELETE FROM email_verification_tokens
 WHERE type = 'secondary_email';

DELETE FROM notification_outbox
 WHERE payload ->> 'template' = 'auth.verifySecondaryEmail'
    OR payload #>> '{vars,verifyUrl}' LIKE '%/verify-secondary-email%';

ALTER TABLE email_verification_tokens
  ALTER COLUMN type TYPE text USING type::text;

DROP TYPE token_type;

CREATE TYPE token_type AS ENUM (
  'primary_email',
  'account_claim',
  'password_reset',
  'sponsor_invite',
  'spot_confirmation'
);

ALTER TABLE email_verification_tokens
  ALTER COLUMN type TYPE token_type USING type::token_type;

DROP TRIGGER IF EXISTS h54_user_email_history ON users;

CREATE OR REPLACE FUNCTION h54_capture_user_email_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  address text;
BEGIN
  FOREACH address IN ARRAY ARRAY[OLD.email, NEW.email]
  LOOP
    IF NULLIF(btrim(address), '') IS NOT NULL THEN
      INSERT INTO user_email_history (user_id, email)
      VALUES (NEW.id, lower(btrim(address)))
      ON CONFLICT (user_id, email) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS users_verified_secondary_email_unique;
ALTER TABLE users DROP COLUMN IF EXISTS secondary_email_verified_at;
ALTER TABLE users DROP COLUMN IF EXISTS secondary_email;

CREATE TRIGGER h54_user_email_history
  AFTER UPDATE OF email ON users
  FOR EACH ROW EXECUTE FUNCTION h54_capture_user_email_history();
