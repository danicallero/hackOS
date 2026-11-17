-- DELTA(H13,H14): reject-and-return. An internal rejection can be marked so
-- that sending it returns the response to its owner as a draft (with the
-- reason) instead of closing it. Like any internal decision it stays invisible
-- to the applicant until sent.
ALTER TABLE application_responses
  ADD COLUMN return_on_send boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT application_responses_return_on_send_check
    CHECK (NOT return_on_send OR status = 'rejected_internal');

-- DELTA(H13,H14): rejections a response went through before it came back as a
-- draft. A resubmitted response is re-reviewed as the same row, so reviewers
-- need this history to see that it was rejected before and why. Kept outside
-- audit_log because the reason is private applicant-facing text.
CREATE TABLE application_response_rejections (
  id bigserial PRIMARY KEY,
  response_id integer NOT NULL REFERENCES application_responses(id) ON DELETE CASCADE,
  reason text CHECK (reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 1000)),
  -- Whether the applicant was told (a sent rejection or a sent reject-and-return).
  notified boolean NOT NULL,
  -- Whether the applicant was invited to resubmit with this rejection.
  returned boolean NOT NULL,
  rejected_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX application_response_rejections_response_idx
  ON application_response_rejections (response_id, created_at DESC);
