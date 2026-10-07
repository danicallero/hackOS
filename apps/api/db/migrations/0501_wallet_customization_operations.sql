-- DELTA(H28, H45/H47, H53): runtime Wallet artwork/settings and durable manual operations.
CREATE TABLE wallet_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  background_color text,
  foreground_color text,
  label_color text,
  website_url text,
  show_directions boolean,
  show_schedule boolean,
  schedule_url text,
  apple_app_store_id bigint,
  android_package_name text,
  android_store_url text,
  apple_options jsonb,
  google_class_options jsonb,
  google_object_options jsonb,
  artwork jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON wallet_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE wallet_artwork (
  id uuid PRIMARY KEY,
  slot text NOT NULL CHECK (slot IN ('appleIcon','appleLogo','appleStrip','appleBackground','appleThumbnail','appleFooter','googleDetail','googleLogo','googleWideLogo','googleHero')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallet_operations (
  id uuid PRIMARY KEY,
  actor_id bigint REFERENCES users(id) ON DELETE SET NULL,
  request_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('alert','refresh')),
  translations jsonb,
  is_test_account boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, request_key)
);
CREATE TABLE wallet_operation_passes (
  operation_id uuid NOT NULL REFERENCES wallet_operations(id) ON DELETE CASCADE,
  pass_id bigint NOT NULL REFERENCES wallet_passes(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  PRIMARY KEY (operation_id, pass_id)
);
CREATE INDEX wallet_operation_passes_pending ON wallet_operation_passes(next_attempt_at) WHERE status = 'queued';
CREATE INDEX wallet_operation_passes_pass ON wallet_operation_passes(pass_id);
