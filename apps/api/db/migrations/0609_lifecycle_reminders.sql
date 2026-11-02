-- DELTA(H1, H12, H52, H54): escalating reminders for forgotten draft
-- applications and unverified accounts.
--
-- plan/schema-boceto.dbml records neither. Each series sends at most three
-- emails, five days apart: the counter is how many were sent, the timestamp
-- when the last one went out (the next one is due five days after it, the
-- first five days after the draft was last edited / the account was created).
ALTER TABLE application_responses
  ADD COLUMN draft_reminders_sent smallint NOT NULL DEFAULT 0
    CONSTRAINT application_responses_draft_reminders_sent_check
    CHECK (draft_reminders_sent BETWEEN 0 AND 3),
  ADD COLUMN draft_reminded_at timestamptz;

ALTER TABLE users
  ADD COLUMN verification_reminders_sent smallint NOT NULL DEFAULT 0
    CONSTRAINT users_verification_reminders_sent_check
    CHECK (verification_reminders_sent BETWEEN 0 AND 3),
  ADD COLUMN verification_reminded_at timestamptz;

-- Single-use link in every unverified-account reminder: "I didn't create this
-- account" deletes it after re-entering its password, with no emailed PIN.
ALTER TYPE token_type ADD VALUE IF NOT EXISTS 'unverified_account_removal';
