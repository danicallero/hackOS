-- 0006_event_config_event_start_pass_visibility.sql — foundation.
--
-- DELTA(H45/H47, H28): the time printed on the Apple Wallet pass is when
-- attendees can ARRIVE at the venue (doors open), which is not the same
-- instant as hacking_starts_at (when the countdown clock starts). Until now
-- the pass reused hacking_starts_at; event_starts_at separates the two.
-- pass_field_visibility is a keyed jsonb of per-field show/hide toggles for
-- the pass's auto-filled front fields (name, role, pass type, university,
-- email — see packages/shared/src/wallet-pass-labels.ts), keyed like
-- pass_field_labels so new toggles never need another migration.
ALTER TABLE event_config
  ADD COLUMN event_starts_at timestamptz,
  ADD COLUMN pass_field_visibility jsonb NOT NULL DEFAULT '{}';
