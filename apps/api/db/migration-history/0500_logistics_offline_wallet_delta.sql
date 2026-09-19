-- DELTA(H25): server-side inbox for scanner local queues and idempotent scan provenance.
ALTER TABLE activity_logs
  ADD COLUMN source_device_id text,
  ADD COLUMN source_scan_id text;

CREATE UNIQUE INDEX activity_logs_source_scan_unique
  ON activity_logs (source_device_id, source_scan_id)
  WHERE source_device_id IS NOT NULL AND source_scan_id IS NOT NULL;

CREATE TABLE meal_scan_batches (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activity_id integer NOT NULL REFERENCES activities(id),
  device_id text NOT NULL,
  submitted_by integer NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER meal_scan_batches_updated_at BEFORE UPDATE ON meal_scan_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE meal_scan_batch_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id integer NOT NULL REFERENCES meal_scan_batches(id) ON DELETE CASCADE,
  activity_id integer NOT NULL REFERENCES activities(id),
  device_id text NOT NULL,
  client_scan_id text NOT NULL,
  badge_id text NOT NULL,
  allow_repeat boolean NOT NULL DEFAULT false,
  scanned_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, client_scan_id)
);

CREATE INDEX meal_scan_batch_items_batch ON meal_scan_batch_items (batch_id);
CREATE INDEX meal_scan_batch_items_status ON meal_scan_batch_items (status);

CREATE TRIGGER meal_scan_batch_items_updated_at BEFORE UPDATE ON meal_scan_batch_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DELTA(H28): PassKit update tags let Apple Wallet ask for changed serials.
ALTER TABLE wallet_passes
  ADD COLUMN update_tag text NOT NULL DEFAULT extract(epoch from now())::text;

-- DELTA(H28): rotated badge passes stay queryable as voided historical serials,
-- while the participant can issue a fresh active badge pass for the new badge.
ALTER TABLE wallet_passes
  DROP CONSTRAINT wallet_passes_user_id_purpose_platform_key;

CREATE UNIQUE INDEX wallet_passes_one_active_user_purpose_platform
  ON wallet_passes (user_id, purpose, platform)
  WHERE status <> 'voided';
