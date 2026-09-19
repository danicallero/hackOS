-- Cleanup (no Hxx story maps to this — flagged as a product-concept removal,
-- not invented): 'submitted' was a deprecated pre-review alias of 'review'.
-- submitResponse() has long since landed directly on 'review'/'confirmed',
-- and 0204_backfill_stuck_submitted.sql already converted any pre-existing
-- rows, so no live code path produces this status anymore. Postgres has no
-- `ALTER TYPE ... DROP VALUE`, so the enum is rebuilt without it. plan/07 §3
-- and invariant 8 have been updated to drop 'submitted' from the documented
-- state machine to match.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM application_responses WHERE status = 'submitted') THEN
    RAISE EXCEPTION 'application_responses has rows with deprecated status ''submitted'' — resolve before running this migration';
  END IF;
END $$;

CREATE TYPE app_response_status_new AS ENUM (
  'draft', 'review', 'accepted', 'confirmed', 'declined', 'rejected', 'expired',
  'accepted_internal', 'rejected_internal'
);

ALTER TABLE application_responses
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE application_responses
  ALTER COLUMN status TYPE app_response_status_new
  USING status::text::app_response_status_new;

ALTER TABLE application_responses
  ALTER COLUMN status SET DEFAULT 'draft';

DROP TYPE app_response_status;

ALTER TYPE app_response_status_new RENAME TO app_response_status;
