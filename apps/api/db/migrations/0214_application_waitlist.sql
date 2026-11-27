-- DELTA(H11,H12,H13,H14): waitlist. A form can switch from "apply" to "join the
-- waitlist" (manually, or automatically once `waitlist_after` applications have
-- been received); a waitlisted response holds no spot and is not counted
-- against `capacity`. Staff move reviewed responses to it and accept from it;
-- the applicant leaves it through the existing `declined` state.
-- ADD VALUE cannot be used in the transaction that adds it, so nothing below
-- references 'waitlist'.
ALTER TYPE app_response_status ADD VALUE IF NOT EXISTS 'waitlist';

ALTER TABLE applications
  ADD COLUMN waitlist_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN waitlist_after integer,
  ADD CONSTRAINT applications_waitlist_after_check
    CHECK (waitlist_after IS NULL OR waitlist_after > 0);

COMMENT ON COLUMN applications.waitlist_enabled IS
  'H11: when true and the window is open, new submissions join the waitlist once waitlist_after applications exist (immediately when waitlist_after is NULL).';
COMMENT ON COLUMN applications.waitlist_after IS
  'H11: applications received (every non-draft response) after which the waitlist starts; NULL = from the moment it is enabled.';
