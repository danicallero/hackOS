-- DELTA(H11,H12,H13,H14): waitlist. Staff switch a form from "apply" to "join
-- the waitlist" by hand; a waitlisted response holds no spot and is not counted
-- against `capacity`. Staff move reviewed responses to it and accept from it;
-- the applicant leaves it through the existing `declined` state.
-- ADD VALUE cannot be used in the transaction that adds it, so nothing below
-- references 'waitlist'.
ALTER TYPE app_response_status ADD VALUE IF NOT EXISTS 'waitlist';

ALTER TABLE applications
  ADD COLUMN waitlist_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN applications.waitlist_enabled IS
  'H11: when true and the window is open, new submissions join the waitlist instead of applying for a place.';
