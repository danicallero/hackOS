-- DELTA(H15): spot-confirmation reminders. The level counts the reminder
-- thresholds already mailed for the decision sent at `basis`; a resent or
-- re-accepted decision has a new decision_sent_at, so the series restarts
-- without every decision path having to reset these columns.
ALTER TABLE application_responses
  ADD COLUMN confirmation_reminder_level smallint NOT NULL DEFAULT 0,
  ADD COLUMN confirmation_reminder_basis timestamptz,
  ADD CONSTRAINT application_responses_confirmation_reminder_level_check
    CHECK (confirmation_reminder_level BETWEEN 0 AND 3);
