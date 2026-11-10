-- 0901_help_desk.sql — H61-H67 help desk: helper profiles, knowledge topics,
-- stated availability and routed help requests.
--
-- DELTA(H61-H67): plan/schema-boceto.dbml has no help desk. New tables:
--   * help_topics: one shared, self-service knowledge catalogue (H61), reused
--     by helper profiles and requests. "Other" is not a topic row: requests
--     carry `other` instead, so it can never be merged or renamed away.
--   * helper_profiles: explicit help desk publication (H61), separate from
--     the #934 public-profile sharing consent. Identity, photo, headline and
--     bio are NOT copied here: they are projected from users and
--     user_public_profiles, so the bio is the same on both profiles.
--   * helper_availability: dated start/end intervals (H62). Venue presence
--     stays in time_logs (H24) and is never derived from these rows.
--   * helpdesk_open_windows: DELTA(H64) the dated windows in which the help
--     desk accepts NEW requests. No rows = always open. Only creating a
--     request is gated; claims, resolution and browsing are not.
--   * help_requests (+ topics, recipients): H64-H66. `recipients` records the
--     routed audience once per (request, helper) so retries never notify twice.
--
-- H54: helper rows cascade on deletion; anonymization deletes the helper
-- profile, topics, availability and recipient rows explicitly
-- (identity/removal.ts) and detaches the person from requests (requester and
-- claimer become NULL, free text is cleared). The H54 trigger rejects writes
-- for pending or anonymized accounts.
--
-- H8: adds the help desk capabilities to the catalogue and seeds them.

CREATE TABLE help_topics (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- Case-, accent- and whitespace-insensitive identity computed by the API
  -- (helpdesk/topics.ts), like the university picker: concurrent proposals
  -- of "Vite" and " vite " resolve to one row.
  name_key text NOT NULL UNIQUE,
  proposed_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE helper_profiles (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT helper_profiles_published_at CHECK (NOT published OR published_at IS NOT NULL)
);
CREATE INDEX helper_profiles_published ON helper_profiles (user_id) WHERE published;

CREATE TRIGGER helper_profiles_set_updated_at
  BEFORE UPDATE ON helper_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER h54_active_user_user_id
  BEFORE INSERT OR UPDATE ON helper_profiles
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('user_id');

CREATE TABLE helper_topics (
  user_id integer NOT NULL REFERENCES helper_profiles(user_id) ON DELETE CASCADE,
  topic_id integer NOT NULL REFERENCES help_topics(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, topic_id)
);
CREATE INDEX helper_topics_topic ON helper_topics (topic_id);

-- DELTA(H65): the challenges a helper is alerted about (and sees); no rows
-- means every request. Any eligible helper may choose them.
CREATE TABLE helper_profile_challenges (
  user_id integer NOT NULL REFERENCES helper_profiles(user_id) ON DELETE CASCADE,
  challenge_id integer NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, challenge_id)
);
CREATE INDEX helper_profile_challenges_challenge ON helper_profile_challenges (challenge_id);

CREATE TABLE helper_availability (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES helper_profiles(user_id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CONSTRAINT helper_availability_window CHECK (ends_at > starts_at)
);
CREATE INDEX helper_availability_user ON helper_availability (user_id, starts_at);
CREATE INDEX helper_availability_window_idx ON helper_availability (starts_at, ends_at);

CREATE TABLE helpdesk_open_windows (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CONSTRAINT helpdesk_open_windows_window CHECK (ends_at > starts_at)
);
CREATE INDEX helpdesk_open_windows_range ON helpdesk_open_windows (starts_at, ends_at);

CREATE TABLE help_requests (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id integer REFERENCES users(id) ON DELETE SET NULL,
  repo_id integer REFERENCES repos(id) ON DELETE SET NULL,
  description text NOT NULL CHECK (char_length(description) <= 500),
  location text NOT NULL CHECK (char_length(location) <= 120),
  other boolean NOT NULL DEFAULT false,
  challenge_id integer REFERENCES challenges(id) ON DELETE SET NULL,
  prefer_sponsor boolean NOT NULL DEFAULT false,
  queued_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'claimed', 'resolved', 'cancelled')),
  routing text NOT NULL CHECK (routing IN ('matched', 'fallback', 'sponsor', 'none')),
  claimed_by integer REFERENCES users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  meeting_mode text CHECK (meeting_mode IN ('on_my_way', 'meet_at')),
  meeting_location text CHECK (meeting_location IS NULL OR char_length(meeting_location) <= 120),
  resolved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT help_requests_claim_shape CHECK (
    (status = 'open' AND claimed_at IS NULL AND meeting_mode IS NULL AND meeting_location IS NULL)
    OR (status <> 'open' AND (claimed_at IS NULL) = (meeting_mode IS NULL))
  ),
  CONSTRAINT help_requests_meet_at_location CHECK (
    meeting_mode IS DISTINCT FROM 'meet_at' OR meeting_location IS NOT NULL
  )
);
-- H64: one active (open or claimed) request per team, and per person for
-- individual requests, so a retried or double-tapped submit cannot open two.
CREATE UNIQUE INDEX help_requests_active_team
  ON help_requests (repo_id) WHERE status IN ('open', 'claimed') AND repo_id IS NOT NULL;
CREATE UNIQUE INDEX help_requests_active_individual
  ON help_requests (requester_id)
  WHERE status IN ('open', 'claimed') AND repo_id IS NULL AND requester_id IS NOT NULL;
CREATE INDEX help_requests_status ON help_requests (status, created_at DESC);
CREATE INDEX help_requests_requester ON help_requests (requester_id, created_at DESC);
CREATE INDEX help_requests_claimed_by ON help_requests (claimed_by) WHERE claimed_by IS NOT NULL;
CREATE INDEX help_requests_repo ON help_requests (repo_id) WHERE repo_id IS NOT NULL;

CREATE TRIGGER help_requests_set_updated_at
  BEFORE UPDATE ON help_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER h54_active_user_requester_id
  BEFORE INSERT OR UPDATE ON help_requests
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('requester_id');
CREATE TRIGGER h54_active_user_claimed_by
  BEFORE INSERT OR UPDATE ON help_requests
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('claimed_by');

CREATE INDEX help_requests_open_queue ON help_requests (queued_at, id) WHERE status = 'open';
CREATE INDEX help_requests_challenge ON help_requests (challenge_id) WHERE challenge_id IS NOT NULL;

CREATE TABLE help_request_topics (
  request_id integer NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
  topic_id integer NOT NULL REFERENCES help_topics(id) ON DELETE CASCADE,
  PRIMARY KEY (request_id, topic_id)
);
CREATE INDEX help_request_topics_topic ON help_request_topics (topic_id);

CREATE TABLE help_request_recipients (
  request_id integer NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX help_request_recipients_user ON help_request_recipients (user_id);

COMMENT ON TABLE help_topics IS 'H61 shared knowledge catalogue for helper profiles and help requests; Other is help_requests.other, not a row.';
COMMENT ON TABLE helper_profiles IS 'H61 explicit help desk publication. Identity and bio are projected from users/user_public_profiles, never copied.';
COMMENT ON TABLE helper_profile_challenges IS 'DELTA(H65) challenges a helper is alerted about and sees; no rows means every request. Open to any eligible helper.';
COMMENT ON TABLE helpdesk_open_windows IS 'DELTA(H64) windows in which the help desk accepts new requests; no rows means always open.';
COMMENT ON TABLE helper_availability IS 'H62 stated availability intervals; venue presence stays in time_logs (H24).';
COMMENT ON TABLE help_requests IS 'H64-H66 help requests (individual or team via repo_id) and their single claim.';
COMMENT ON TABLE help_request_recipients IS 'H65 routed audience: one row per notified helper, so retries never deliver twice.';

-- H8 capability catalogue.
ALTER TABLE public.role_capabilities DROP CONSTRAINT role_capabilities_known_catalogue;
ALTER TABLE public.role_capabilities
  ADD CONSTRAINT role_capabilities_known_catalogue CHECK ((capability = ANY (ARRAY[
    '*'::text, 'users:read'::text, 'users:write'::text, 'permissions:manage'::text,
    'invites:manage'::text, 'applications:manage'::text, 'applications:review'::text,
    'applications:decide'::text, 'applications:confirm-override'::text,
    'applications:edit-response'::text, 'statistics:manage'::text, 'projects:read'::text,
    'projects:import'::text, 'projects:edit'::text, 'accredit:scan'::text,
    'presence:scan'::text, 'activity:scan'::text, 'logistics:stats'::text,
    'intolerances:manage'::text, 'meal-plans:export'::text, 'meal-plans:manage'::text,
    'queue:status'::text, 'queue:operate'::text, 'queue:admin'::text, 'judge:panel'::text,
    'judging:export'::text, 'sponsors:manage'::text, 'challenges:manage'::text,
    'schedule:read'::text, 'schedule:manage'::text, 'announcements:manage'::text,
    'tv:control'::text, 'notifications:send'::text, 'audit:read'::text, 'exports:run'::text,
    'event:manage'::text, 'venue:manage'::text, 'wallet:manage'::text,
    'presence:manage'::text, 'helpdesk:offer'::text, 'helpdesk:request'::text,
    'helpdesk:coverage'::text, 'helpdesk:manage'::text])));

-- Seeded grants (H61: mentors, sponsor representatives and staff offer help;
-- participants request it; organizers see coverage). Roles are matched by
-- name among the seeded set; the permissions UI can change them afterwards.
WITH grants(role_name, capability) AS (
  VALUES
    ('Mentor', 'helpdesk:offer'),
    ('Sponsor', 'helpdesk:offer'),
    ('Organizer', 'helpdesk:offer'),
    ('Day Staff', 'helpdesk:offer'),
    ('Event Director', 'helpdesk:offer'),
    ('Participant', 'helpdesk:request'),
    ('Event Director', 'helpdesk:request'),
    ('Organizer', 'helpdesk:coverage'),
    ('Event Director', 'helpdesk:coverage'),
    ('Event Director', 'helpdesk:manage')
)
INSERT INTO public.role_capabilities (role_id, capability, state)
SELECT r.id, g.capability, 'allow'::public.permission_state
  FROM grants g
  JOIN public.roles r ON r.name = g.role_name AND r.is_seeded AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Seeded-role reset keeps the same defaults.
WITH grants(role_name, capability) AS (
  VALUES
    ('Mentor', 'helpdesk:offer'),
    ('Sponsor', 'helpdesk:offer'),
    ('Organizer', 'helpdesk:offer'),
    ('Day Staff', 'helpdesk:offer'),
    ('Event Director', 'helpdesk:offer'),
    ('Participant', 'helpdesk:request'),
    ('Event Director', 'helpdesk:request'),
    ('Organizer', 'helpdesk:coverage'),
    ('Event Director', 'helpdesk:coverage'),
    ('Event Director', 'helpdesk:manage')
), per_role AS (
  SELECT r.id AS role_id, jsonb_object_agg(g.capability, 'allow') AS caps
    FROM grants g
    JOIN public.roles r ON r.name = g.role_name AND r.is_seeded AND r.deleted_at IS NULL
   GROUP BY r.id
)
UPDATE public.role_seed_defaults d
   SET capabilities = d.capabilities || p.caps
  FROM per_role p
 WHERE d.role_id = p.role_id;
