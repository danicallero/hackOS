-- 0001_initial.sql — hackOS base schema.
-- Source: plan/schema-boceto.dbml, revised against plan/historias-hackos.md
-- per plan/06 checklist. Deltas vs the boceto are marked with "DELTA(Hxx)".
--
-- DELTA summary:
--   * users.password_hash removed; users.email_verified is boolean and
--     users.image added — credentials/sessions live in Better Auth tables
--     (identity workstream migrations 01xx). (H1, H4)
--   * group_capabilities + permission_group_includes added: the boceto had
--     groups but nothing granting capabilities, and H8 requires groups of
--     groups. (H8)
--   * idempotency_keys added (plan/03 Fase 0 idempotency contract).
--   * queue_status has no legacy 'standby' value (greenfield build). (H29)

-- ── helpers ────────────────────────────────────────────────────────────────

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── enums ──────────────────────────────────────────────────────────────────

CREATE TYPE token_type AS ENUM (
  'primary_email', 'secondary_email', 'account_claim', 'password_reset',
  'sponsor_invite', 'spot_confirmation'
);

CREATE TYPE challenge_status AS ENUM ('draft', 'active', 'published', 'archived');

CREATE TYPE queue_status AS ENUM (
  'waiting', 'called', 'in_room', 'presenting', 'completed',
  'returned_to_queue', 'no_show', 'skipped', 'cancelled', 'disqualified'
);

CREATE TYPE app_response_status AS ENUM (
  'draft', 'submitted', 'review', 'accepted', 'confirmed', 'declined',
  'rejected', 'expired'
);

CREATE TYPE notification_channel AS ENUM ('in_app', 'email', 'discord', 'push');

-- ── identity (H1-H10) ──────────────────────────────────────────────────────

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  -- DELTA(H1): boolean for Better Auth compatibility (boceto had timestamptz)
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  name text,
  surname text,
  phone text,
  dni text,
  -- current accreditation QR; rotations append the old one to badge_id_history (H23)
  badge_id text UNIQUE,
  badge_id_history text[] NOT NULL DEFAULT '{}',
  -- ids into food_intolerances — array, no FK enforcement
  food_intolerances integer[] NOT NULL DEFAULT '{}',
  food_intolerance_notes text,
  university_id integer,
  shirt_size text,
  language text NOT NULL DEFAULT 'en', -- en | es | gl
  secondary_email text,
  secondary_email_verified_at timestamptz, -- verified == not null (H6)
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS 'No role column: role is derived at login from relationships (admin > staff > judge > sponsor > participant). Permissions come from capability groups only (H8).';

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permission_groups (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text
);

-- DELTA(H8): capability grants per group. Capability strings come from
-- packages/shared/src/capabilities.ts; '*' is the admin wildcard.
CREATE TABLE group_capabilities (
  group_id integer NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  capability text NOT NULL,
  PRIMARY KEY (group_id, capability)
);

-- DELTA(H8): groups of groups. Membership in parent implies capabilities of
-- children (expanded recursively; cycles rejected at the API layer).
CREATE TABLE permission_group_includes (
  parent_group_id integer NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  child_group_id integer NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_group_id, child_group_id),
  CHECK (parent_group_id <> child_group_id)
);

CREATE TABLE permission_group_members (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id integer NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  assigned_by integer REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE universities (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  proposed_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT users_university_fk
  FOREIGN KEY (university_id) REFERENCES universities(id);

-- Custom token flows (secondary email H6, account claim H10/H17, sponsor
-- invite H9/H43, spot confirmation H15). Better Auth covers primary email
-- verification + password reset internally; those enum values stay for
-- flexibility/overrides.
CREATE TABLE email_verification_tokens (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token text NOT NULL UNIQUE,
  type token_type NOT NULL,
  email text NOT NULL,
  user_id integer REFERENCES users(id),
  enterprise_id integer, -- FK added after enterprises; only for sponsor_invite
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── sponsors (H9, H43-H46) ─────────────────────────────────────────────────

CREATE TABLE sponsor_tiers (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  max_seats integer NOT NULL DEFAULT 1,
  max_challenges integer NOT NULL DEFAULT 1,
  max_judges integer NOT NULL DEFAULT 0,
  logo_priority integer NOT NULL DEFAULT 0, -- ordering on the public logo grid
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enterprises (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  logo_url text,
  website text,
  tier_id integer REFERENCES sponsor_tiers(id),
  director_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_verification_tokens ADD CONSTRAINT evt_enterprise_fk
  FOREIGN KEY (enterprise_id) REFERENCES enterprises(id);

CREATE TABLE sponsors (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enterprise_id integer NOT NULL REFERENCES enterprises(id),
  user_id integer REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now()
);

-- ── challenges (H44-H45) ───────────────────────────────────────────────────

CREATE TABLE challenges (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author integer NOT NULL REFERENCES sponsors(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '', -- markdown
  criteria text, -- public-facing criteria text
  judging_panel_criteria jsonb, -- drives the dynamic judge scoring form (H36, H44)
  prizes jsonb, -- name + link per prize
  -- Devpost "Opt-In Prize" aliases; import matches against these so one prize
  -- export maps to an existing challenge instead of creating a duplicate (H16)
  devpost_tags jsonb NOT NULL DEFAULT '[]',
  status challenge_status NOT NULL DEFAULT 'draft',
  max_presentation_seconds integer,
  auto_call_count integer NOT NULL DEFAULT 3,
  visibility text NOT NULL DEFAULT 'hidden', -- visible | hidden
  available_from timestamptz, -- auto-reveal (H45): hidden until this time on the public API
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER challenges_updated_at BEFORE UPDATE ON challenges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── rooms & queue (H29-H40) ────────────────────────────────────────────────

CREATE TABLE rooms (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  location text,
  status text NOT NULL DEFAULT 'paused', -- active | paused
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER rooms_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- N:M — a challenge spanning 5 rooms still has ONE logical queue, shared
-- across them (the pump distributes).
CREATE TABLE room_challenges (
  room_id integer NOT NULL REFERENCES rooms(id),
  challenge_id integer NOT NULL REFERENCES challenges(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by integer REFERENCES users(id),
  PRIMARY KEY (room_id, challenge_id)
);

CREATE TABLE room_judges (
  room_id integer NOT NULL REFERENCES rooms(id),
  challenge_id integer NOT NULL REFERENCES challenges(id),
  user_id integer NOT NULL REFERENCES users(id),
  assigned_by integer REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, challenge_id, user_id)
);

CREATE TABLE room_queue_state (
  room_id integer PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  is_paused boolean NOT NULL DEFAULT false,
  -- per-room cap on concurrent `called` entries; pump + CallNext both honour it (H29)
  max_in_waiting_area integer NOT NULL DEFAULT 2,
  desired_minutes_per_team integer NOT NULL DEFAULT 8, -- H39
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER room_queue_state_updated_at BEFORE UPDATE ON room_queue_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE queue_settings (
  id integer PRIMARY KEY, -- singleton, id=1
  handoff_buffer_minutes integer NOT NULL DEFAULT 5,
  schedule_start_at timestamptz,
  schedule_end_at timestamptz,
  pre_call_notification_eta_minutes integer NOT NULL DEFAULT 10, -- H38 pre-aviso
  requeue_prompt_default text NOT NULL DEFAULT 'ask', -- top | bottom | ask
  CHECK (id = 1)
);
INSERT INTO queue_settings (id) VALUES (1);

CREATE TABLE repos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  github_url text,
  devpost_url text,
  demo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE repos IS 'A project/team. Deliberately independent from application_responses — registration teams and submission teams need not match.';

CREATE TRIGGER repos_updated_at BEFORE UPDATE ON repos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE queue_entries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id integer NOT NULL REFERENCES challenges(id),
  repo_id integer NOT NULL REFERENCES repos(id),
  assigned_room_id integer REFERENCES rooms(id),
  status queue_status NOT NULL DEFAULT 'waiting',
  position integer,
  priority integer NOT NULL DEFAULT 0,
  call_count integer NOT NULL DEFAULT 0, -- no-show ladder (H34)
  called_at timestamptz,
  presentation_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER queue_entries_updated_at BEFORE UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- one entry per (challenge, repo) — makes duplicate siblings structurally
-- impossible (plan/07 invariant 1)
CREATE UNIQUE INDEX queue_entries_challenge_repo ON queue_entries (challenge_id, repo_id);
CREATE INDEX queue_entries_challenge_status ON queue_entries (challenge_id, status);
CREATE INDEX queue_entries_room_status ON queue_entries (assigned_room_id, status);
-- at most one entry per room in (in_room, presenting); excludes `called` on
-- purpose — that's the waiting-area buffer (plan/07 invariant 2)
CREATE UNIQUE INDEX one_active_per_room ON queue_entries (assigned_room_id)
  WHERE status IN ('in_room', 'presenting');

-- Every queue action writes exactly one history row (plan/07 invariant 5),
-- including no-transition actions like notify_enter.
CREATE TABLE queue_history (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue_entry_id integer NOT NULL REFERENCES queue_entries(id),
  actor_id integer NOT NULL REFERENCES users(id),
  previous_status text NOT NULL,
  new_status text NOT NULL,
  action text NOT NULL,
  reason text,
  metadata jsonb, -- e.g. requeue position top|bottom
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX queue_history_entry ON queue_history (queue_entry_id);

-- ── judging (H36-H37, H40) ─────────────────────────────────────────────────

-- Collaborative: all judges in the room edit the same row, field-level
-- last-write-wins. History lives in attempt_review_versions.
CREATE TABLE attempt_review (
  attempt_id integer PRIMARY KEY REFERENCES queue_entries(id), -- 1:1 with queue_entries
  scores jsonb NOT NULL DEFAULT '{}', -- keys follow challenges.judging_panel_criteria
  notes text,
  status text NOT NULL DEFAULT 'draft', -- draft | submitted
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER attempt_review_updated_at BEFORE UPDATE ON attempt_review
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per save. Answers "who changed this score" (H36).
CREATE TABLE attempt_review_versions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id integer NOT NULL REFERENCES queue_entries(id),
  author_id integer NOT NULL REFERENCES users(id),
  changed_fields text[] NOT NULL,
  previous jsonb,
  new jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempt_review_versions_attempt ON attempt_review_versions (attempt_id);

CREATE TABLE judging_session (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  judge_id integer NOT NULL REFERENCES users(id),
  queue_entry_id integer NOT NULL REFERENCES queue_entries(id),
  room_id integer REFERENCES rooms(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  ended_at timestamptz
);

-- ── devpost intake (H16-H17) ───────────────────────────────────────────────

CREATE TABLE submissions (
  repo_id integer NOT NULL REFERENCES repos(id),
  user_id integer NOT NULL REFERENCES users(id),
  imported_from text NOT NULL DEFAULT 'manual', -- manual | devpost
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, user_id)
);

CREATE TABLE devpost_participants (
  repo_id integer NOT NULL REFERENCES repos(id),
  email text NOT NULL,
  name text,
  surname text,
  devpost_username text,
  user_id integer REFERENCES users(id), -- null until matched/claimed
  import_batch text NOT NULL,
  merge_status text NOT NULL DEFAULT 'unmatched', -- unmatched | auto_matched | manually_linked
  linked_by integer REFERENCES users(id),
  linked_at timestamptz,
  claim_email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, email)
);

-- Every opt-in prize name ever seen in an import, so the challenge editor
-- can autocomplete devpost_tags.
CREATE TABLE devpost_prizes (
  name text PRIMARY KEY,
  last_batch text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER devpost_prizes_updated_at BEFORE UPDATE ON devpost_prizes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Persisted at import time. Mapping a prize to a challenge later enqueues
-- these repos without re-importing the CSV.
CREATE TABLE repo_devpost_prizes (
  repo_id integer NOT NULL REFERENCES repos(id),
  prize text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, prize)
);

-- ── schedule & activities (H24-H26, H47-H48) ───────────────────────────────

CREATE TABLE schedule (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  description text, -- markdown
  location text,
  type text, -- meal | workshop | ceremony | activity | other
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  visibility text NOT NULL DEFAULT 'hidden', -- shown | hidden
  publish_at timestamptz, -- timed reveal (H48)
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER schedule_updated_at BEFORE UPDATE ON schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE activities (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general', -- meals are activities too — entitlements hang off this
  requires_scan boolean NOT NULL DEFAULT false,
  color text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per scan (H25-H26). Meal repeat count = count of rows for the meal
-- activity; staff decides on seconds.
CREATE TABLE activity_logs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  activity_id integer NOT NULL REFERENCES activities(id),
  notes text,
  logged_at timestamptz NOT NULL DEFAULT now(),
  logged_by integer NOT NULL REFERENCES users(id)
);
CREATE INDEX activity_logs_user ON activity_logs (user_id);
CREATE INDEX activity_logs_activity ON activity_logs (activity_id);

CREATE TABLE check_in_logs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  badge_id text, -- badge as scanned, kept even after rotation
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  check_in_method text NOT NULL DEFAULT 'manual', -- manual | qr | nfc
  staff_id integer NOT NULL REFERENCES users(id),
  notes text
);

CREATE TABLE time_logs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  kind text NOT NULL, -- in | out — presence hours are derived on read, never stored (H24)
  scanned_at timestamptz NOT NULL DEFAULT now(),
  scanned_by integer NOT NULL REFERENCES users(id),
  location text,
  notes text
);

CREATE TABLE food_intolerances (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label jsonb NOT NULL, -- i18n: {en, es, gl}
  description jsonb,
  proposed_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Row present = may redeem. First scan auto-redeems; staff +1 override is audited. (H25)
CREATE TABLE meal_entitlements (
  user_id integer NOT NULL REFERENCES users(id),
  activity_id integer NOT NULL REFERENCES activities(id),
  PRIMARY KEY (user_id, activity_id)
);

-- ── applications (H11-H15) ─────────────────────────────────────────────────

CREATE TABLE applications (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL, -- participant | mentor | sponsor | volunteer
  template jsonb NOT NULL, -- form schema — fields rendered dynamically
  description text,
  active boolean NOT NULL DEFAULT true,
  open_at timestamptz,
  close_at timestamptz,
  capacity integer, -- accepting past this is a 409
  confirmation_window_hours integer NOT NULL DEFAULT 168,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE application_responses (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  application_id integer NOT NULL REFERENCES applications(id),
  referrer_user_id integer REFERENCES users(id),
  referrer_application_id integer REFERENCES application_responses(id),
  status app_response_status NOT NULL DEFAULT 'draft',
  responses jsonb NOT NULL DEFAULT '{}',
  staff_notes text, -- shared internal note; per-reviewer scoring lives in applicant_reviews
  confirmation_token_id integer REFERENCES email_verification_tokens(id),
  confirmed_at timestamptz,
  declined_at timestamptz,
  decision_sent_at timestamptz, -- decisions are internal until the batch email sets this (H14)
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, application_id)
);

CREATE TRIGGER application_responses_updated_at BEFORE UPDATE ON application_responses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE applicant_reviews (
  response_id integer NOT NULL REFERENCES application_responses(id),
  author_id integer NOT NULL REFERENCES users(id),
  score integer CHECK (score BETWEEN 0 AND 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (response_id, author_id)
);

CREATE TRIGGER applicant_reviews_updated_at BEFORE UPDATE ON applicant_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── tickets & wallet (H15, H22-H23, H28) ───────────────────────────────────

CREATE TABLE tickets (
  user_id integer PRIMARY KEY REFERENCES users(id),
  token text NOT NULL UNIQUE, -- signed QR payload; permanent, never voided (plan/07 invariant 10)
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_passes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  purpose text NOT NULL, -- ticket | badge
  platform text NOT NULL, -- apple | google
  serial_number text NOT NULL,
  authentication_token text NOT NULL,
  google_object_id text,
  status text NOT NULL DEFAULT 'active', -- active | voided — badge passes void on badge rotation
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, purpose, platform)
);

CREATE TABLE wallet_pass_devices (
  pass_id integer NOT NULL REFERENCES wallet_passes(id),
  device_library_identifier text NOT NULL,
  push_token text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pass_id, device_library_identifier)
);

-- ── notifications & announcements (H50-H52) ────────────────────────────────

CREATE TABLE notification_preferences (
  user_id integer NOT NULL REFERENCES users(id),
  category text NOT NULL,
  channel notification_channel NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, category, channel)
);

CREATE TABLE notification_outbox (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  category text NOT NULL,
  channel notification_channel NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'queued', -- queued | sent | failed
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz DEFAULT now(), -- exponential backoff
  sent_at timestamptz,
  read_at timestamptz, -- doubles as the in-app inbox read marker
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_outbox_pending ON notification_outbox (next_attempt_at)
  WHERE status = 'queued';
CREATE INDEX notification_outbox_user ON notification_outbox (user_id);

CREATE TABLE push_tokens (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE, -- Expo token — routes to APNs/FCM transparently
  platform text, -- ios | android, informational
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER push_tokens_updated_at BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE announcements (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id integer NOT NULL REFERENCES users(id),
  title text NOT NULL,
  body text NOT NULL, -- markdown
  target_role text, -- null = everyone
  publish_at timestamptz, -- timed show/hide, same trick as schedule.publish_at
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcement_reads (
  announcement_id integer NOT NULL REFERENCES announcements(id),
  user_id integer NOT NULL REFERENCES users(id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

-- ── refresh/auth note ──────────────────────────────────────────────────────
-- The boceto's refresh_tokens table is intentionally absent: session/token
-- storage belongs to Better Auth (identity workstream, migrations 01xx).

-- ── audit (H53) ────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id integer REFERENCES users(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  source text, -- email | web | admin | system
  before jsonb,
  after jsonb,
  reason text,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor ON audit_log (actor_id);

-- ── idempotency (plan/03 Fase 0) ───────────────────────────────────────────

CREATE TABLE idempotency_keys (
  key text NOT NULL,
  scope text NOT NULL, -- "METHOD /route u:<userId>"
  request_hash text NOT NULL,
  response_status integer, -- null while the first execution is in flight
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (key, scope)
);
