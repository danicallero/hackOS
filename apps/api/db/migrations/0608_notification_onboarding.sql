-- DELTA(H51, H52): first-run notification channel onboarding.
--
-- plan/schema-boceto.dbml has no record of whether a person has chosen their
-- notification channels. People with event access are asked once, on web and
-- mobile; this stamps when they did, so the prompt is not shown again on any
-- device. NULL = not yet asked.
ALTER TABLE users ADD COLUMN notification_onboarded_at timestamptz;
