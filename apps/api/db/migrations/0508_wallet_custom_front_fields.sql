-- H28: admin-defined front fields on Apple/Google Wallet passes, shown after
-- the auto-filled holder fields. Same {label, value} shape as pass_back_fields.
-- DELTA(H28): plan/schema-boceto.dbml has no per-event pass field config.
ALTER TABLE event_config
  ADD COLUMN pass_front_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
