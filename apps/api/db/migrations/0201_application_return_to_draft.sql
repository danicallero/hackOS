-- DELTA(H12,H14): a decision-maker may return one response to its owner as a
-- draft, optionally allowing that specific draft to be submitted after close
-- and automatically re-accepting it on resubmission.
ALTER TABLE application_responses
  ADD COLUMN allow_resubmit_after_close boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_accept_on_resubmit boolean NOT NULL DEFAULT false;
