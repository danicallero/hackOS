-- DELTA(#934, #935; H7/H10/H15): distinguish a networking opt-out from an unanswered prompt.
ALTER TABLE user_public_profiles ADD COLUMN onboarding_completed_at timestamptz;
UPDATE user_public_profiles SET onboarding_completed_at = consented_at
WHERE consented_at IS NOT NULL;
