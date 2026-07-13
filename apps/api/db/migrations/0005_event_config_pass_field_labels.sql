-- 0005_event_config_pass_field_labels.sql — foundation.
--
-- DELTA(H45/H47, H28): admin-editable caption text for the Apple Wallet pass
-- (e.g. "Participant", "Role", "University" — see
-- packages/shared/src/wallet-pass-labels.ts for the full catalogue and
-- defaults). Keyed object rather than one column per caption so adding a new
-- customizable caption never needs another migration.
ALTER TABLE event_config
  ADD COLUMN pass_field_labels jsonb NOT NULL DEFAULT '{}';
