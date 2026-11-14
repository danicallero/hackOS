-- Multi-edition support (docs/multi-edition-plan.md). One installation serves
-- several editions without mixing their data; people (users, profile,
-- preferences) and catalogues stay global. No H-number covers the feature as a
-- whole; each delta below names the story whose data it scopes.
--
-- DELTA(H8) vs plan/schema-boceto.dbml: `editions` catalogue; `user_roles`
-- gains `event_key` (NULL only for protected, CLI-provisioned roles such as
-- system:superadmin); `user_role_event_evidence` becomes a view over the
-- per-edition roles so there is a single source of truth.
-- DELTA(H43, H44): enterprises are per edition, unique (event_key, name).
-- DELTA(H16-H21, H29-H40, H47-H48, H61-H67, H22-H28, H50, H54): root event
-- tables carry `event_key`; children inherit it through their FK.
--
-- Backfill: every existing row belongs to the current edition
-- (event_config.event_key). ADD COLUMN ... DEFAULT current_edition() NOT NULL
-- evaluates the stable default once, so the backfill is deterministic and
-- does not rewrite the table.

-- Deferred certificate triggers on user_roles (0504) must fire as rows are
-- backfilled, or the later ALTER TABLE finds pending trigger events.
SET CONSTRAINTS ALL IMMEDIATE;

-- 1. Editions --------------------------------------------------------------

CREATE TABLE public.editions (
  event_key text PRIMARY KEY CHECK (event_key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  closed_at timestamptz,
  -- event_config as it was when another edition was activated (history only).
  settings_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editions_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT editions_closed_at CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE TRIGGER editions_updated_at BEFORE UPDATE ON public.editions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The current edition, plus every historical key already recorded by the
-- edition-scoped tables from 0803 (closed: their event already happened).
INSERT INTO public.editions (event_key, name, starts_at, ends_at, status)
SELECT event_key, COALESCE(NULLIF(btrim(name), ''), event_key), event_starts_at, event_ends_at, 'active'
  FROM public.event_config WHERE id = 1;
INSERT INTO public.editions (event_key, name, status, closed_at)
SELECT k, k, 'closed', now() FROM (
  SELECT event_key AS k FROM public.applications
  UNION SELECT event_key FROM public.user_role_event_evidence
  UNION SELECT event_key FROM public.mentor_profiles
  UNION SELECT event_key FROM public.onboarding_step_states
  UNION SELECT event_key FROM public.activity_rsvps
  UNION SELECT event_key FROM public.activity_rsvp_settings
) keys
ON CONFLICT (event_key) DO NOTHING;

ALTER TABLE public.event_config
  ADD CONSTRAINT event_config_event_key_fkey FOREIGN KEY (event_key)
  REFERENCES public.editions(event_key) ON UPDATE CASCADE;
-- Writing a new key into event_config (legacy PUT /api/event eventKey, tests,
-- seeds) opens that edition if the catalogue does not have it yet.
CREATE FUNCTION public.event_config_ensure_edition() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.editions (event_key, name, starts_at, ends_at, status)
  VALUES (NEW.event_key, COALESCE(NULLIF(btrim(NEW.name), ''), NEW.event_key),
          NEW.event_starts_at, NEW.event_ends_at, 'active')
  ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER event_config_ensure_edition BEFORE INSERT OR UPDATE OF event_key ON public.event_config
  FOR EACH ROW EXECUTE FUNCTION public.event_config_ensure_edition();

-- The current edition's name and dates are edited in event settings (H45);
-- the catalogue row mirrors them so edition lists never disagree.
CREATE FUNCTION public.event_config_mirror_edition() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.editions
     SET name = COALESCE(NULLIF(btrim(NEW.name), ''), name),
         starts_at = NEW.event_starts_at,
         ends_at = NEW.event_ends_at
   WHERE event_key = NEW.event_key;
  RETURN NULL;
END $$;
CREATE TRIGGER event_config_mirror_edition AFTER UPDATE OF name, event_starts_at, event_ends_at ON public.event_config
  FOR EACH ROW EXECUTE FUNCTION public.event_config_mirror_edition();

-- The edition a statement acts on: the request's viewed edition (X-Edition,
-- set per transaction/connection by the API as `hackos.edition`) or, when
-- unset, the current edition in event_config ('default' before the singleton
-- exists, matching the API's historical fallback). Every edition-scoped column
-- defaults to it and list queries filter by it.
CREATE FUNCTION public.current_edition() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('hackos.edition', true), ''),
                  (SELECT event_key FROM public.event_config WHERE id = 1),
                  'default')
$$;

-- Single write guard (plan §3): a closed edition is read-only. The API also
-- rejects mutations up front (route preHandler); this is the in-transaction
-- backstop. Superadmin writes, the close/reopen transaction itself and
-- account erasure set `hackos.edition_write_override = on` locally.
CREATE FUNCTION public.edition_write_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  keys text[];
  closed_key text;
BEGIN
  IF current_setting('hackos.edition_write_override', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN keys := ARRAY[NEW.event_key];
  ELSIF TG_OP = 'DELETE' THEN keys := ARRAY[OLD.event_key];
  ELSE keys := ARRAY[OLD.event_key, NEW.event_key];
  END IF;
  SELECT e.event_key INTO closed_key FROM public.editions e
   WHERE e.event_key = ANY(keys) AND e.status = 'closed' LIMIT 1;
  IF closed_key IS NOT NULL THEN
    RAISE EXCEPTION 'Edition % is closed and read-only', closed_key
      USING ERRCODE = 'HKE01', DETAIL = closed_key;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Children that keep their own event_key (for filtering) take it from the
-- parent row, so a write through a by-id endpoint never lands in a different
-- edition than its parent. TG_ARGV: parent table, FK column on NEW.
CREATE FUNCTION public.edition_inherit_from_parent() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_id text := to_jsonb(NEW) ->> TG_ARGV[1];
  parent_key text;
BEGIN
  IF parent_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT event_key FROM public.%I WHERE id = $1', TG_ARGV[0])
    INTO parent_key USING parent_id::integer;
  IF parent_key IS NOT NULL THEN NEW.event_key := parent_key; END IF;
  RETURN NEW;
END $$;

-- 2. Roles per edition (H8) ------------------------------------------------

ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_pkey;
ALTER TABLE public.user_roles
  ADD COLUMN event_key text DEFAULT public.current_edition()
  REFERENCES public.editions(event_key) ON UPDATE CASCADE;
UPDATE public.user_roles ur SET event_key = NULL
  FROM public.roles r WHERE r.id = ur.role_id AND r.is_protected;
-- Historical grants recorded as evidence for an earlier edition become that
-- edition's roles (they were the only record of who held what then).
INSERT INTO public.user_roles (user_id, role_id, event_key, assigned_at, source)
SELECT ev.user_id, ev.role_id, ev.event_key, ev.assigned_at, 'edition_backfill'
  FROM public.user_role_event_evidence ev
  JOIN public.roles r ON r.id = ev.role_id AND NOT r.is_protected
 WHERE ev.event_key <> (SELECT event_key FROM public.event_config WHERE id = 1);
-- PK columns cannot be NULL, so the key is a NULLS NOT DISTINCT unique
-- constraint: one global row per protected role, one row per edition else.
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_role_edition_key
  UNIQUE NULLS NOT DISTINCT (user_id, role_id, event_key);
CREATE INDEX user_roles_edition_user ON public.user_roles (event_key, user_id);

-- Only protected roles are global. A CHECK cannot read roles.is_protected, so
-- this trigger normalises protected grants to NULL and rejects a NULL edition
-- for every other role.
CREATE FUNCTION public.user_roles_edition_scope() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT is_protected FROM public.roles WHERE id = NEW.role_id) THEN
    NEW.event_key := NULL;
  ELSIF NEW.event_key IS NULL THEN
    RAISE EXCEPTION 'Role % must be assigned within an edition', NEW.role_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_roles_edition_scope BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_edition_scope();

DROP VIEW public.event_attendance_kinds;
DROP TRIGGER user_roles_event_evidence ON public.user_roles;
DROP FUNCTION public.record_role_event_evidence();
DROP TABLE public.user_role_event_evidence;
CREATE VIEW public.user_role_event_evidence AS
SELECT user_id, role_id, event_key, assigned_at FROM public.user_roles WHERE event_key IS NOT NULL;

CREATE OR REPLACE VIEW public.user_effective_capabilities AS
SELECT user_id, capability
  FROM (SELECT DISTINCT ON (ur.user_id, rc.capability) ur.user_id, rc.capability, rc.state
          FROM public.user_roles ur
          JOIN public.roles r ON r.id = ur.role_id
          JOIN public.role_capabilities rc ON rc.role_id = r.id
         WHERE rc.state <> 'inherit'::public.permission_state AND r.deleted_at IS NULL
           AND (ur.event_key IS NULL OR ur.event_key = public.current_edition())
         ORDER BY ur.user_id, rc.capability, r."position" DESC) resolved
 WHERE state = 'allow'::public.permission_state;

CREATE OR REPLACE VIEW public.user_effective_role_name AS
SELECT DISTINCT ON (ur.user_id) ur.user_id, r.name AS role_name
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
 WHERE r.is_visible = true AND r.deleted_at IS NULL
   AND (ur.event_key IS NULL OR ur.event_key = public.current_edition())
 ORDER BY ur.user_id, r."position" DESC;

CREATE OR REPLACE VIEW public.user_event_access AS
SELECT DISTINCT ur.user_id
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.users u ON u.id = ur.user_id
 WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
   AND r.event_access = true AND r.deleted_at IS NULL
   AND (ur.event_key IS NULL OR ur.event_key = public.current_edition());

-- 3. Already edition-keyed tables (0803) join the catalogue ----------------

ALTER TABLE public.applications ALTER COLUMN event_key SET DEFAULT public.current_edition(),
  ADD CONSTRAINT applications_event_key_fkey FOREIGN KEY (event_key) REFERENCES public.editions(event_key) ON UPDATE CASCADE;
ALTER TABLE public.mentor_profiles ALTER COLUMN event_key SET DEFAULT public.current_edition(),
  ADD CONSTRAINT mentor_profiles_event_key_fkey FOREIGN KEY (event_key) REFERENCES public.editions(event_key) ON UPDATE CASCADE;
ALTER TABLE public.onboarding_step_states ALTER COLUMN event_key SET DEFAULT public.current_edition(),
  ADD CONSTRAINT onboarding_step_states_event_key_fkey FOREIGN KEY (event_key) REFERENCES public.editions(event_key) ON UPDATE CASCADE;
ALTER TABLE public.activity_rsvps ALTER COLUMN event_key SET DEFAULT public.current_edition(),
  ADD CONSTRAINT activity_rsvps_event_key_fkey FOREIGN KEY (event_key) REFERENCES public.editions(event_key) ON UPDATE CASCADE;
ALTER TABLE public.activity_rsvp_settings ALTER COLUMN event_key SET DEFAULT public.current_edition(),
  ADD CONSTRAINT activity_rsvp_settings_event_key_fkey FOREIGN KEY (event_key) REFERENCES public.editions(event_key) ON UPDATE CASCADE;

-- 4. Root event tables gain event_key --------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'enterprises', 'challenges', 'repos', 'rooms', 'queue_groups', 'queue_entries',
    'schedule', 'activities', 'announcements', 'help_requests', 'helpdesk_open_windows',
    'helper_profiles', 'helper_topics', 'helper_profile_challenges', 'helper_availability',
    'tickets', 'check_in_logs', 'time_logs', 'wallet_passes', 'diary_entries',
    'attendance_certificates', 'certificate_approvals', 'scanner_revoked_badges',
    'scanner_revoked_tickets'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN event_key text NOT NULL DEFAULT public.current_edition() '
      'REFERENCES public.editions(event_key) ON UPDATE CASCADE', t);
    EXECUTE format('CREATE INDEX %I ON public.%I (event_key)', t || '_event_key', t);
  END LOOP;
END $$;

-- Enterprises: one row per enterprise and edition, never recurrent (H43).
ALTER TABLE public.enterprises DROP CONSTRAINT enterprises_name_key;
ALTER TABLE public.enterprises ADD CONSTRAINT enterprises_edition_name_key UNIQUE (event_key, name);

-- Challenges take their enterprise's edition (author -> sponsor -> enterprise).
CREATE FUNCTION public.challenge_inherit_edition() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE parent_key text;
BEGIN
  SELECT en.event_key INTO parent_key FROM public.sponsors s
    JOIN public.enterprises en ON en.id = s.enterprise_id WHERE s.id = NEW.author;
  IF parent_key IS NOT NULL THEN NEW.event_key := parent_key; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER challenges_edition_inherit BEFORE INSERT ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.challenge_inherit_edition();
CREATE TRIGGER queue_groups_edition_inherit BEFORE INSERT ON public.queue_groups
  FOR EACH ROW EXECUTE FUNCTION public.edition_inherit_from_parent('enterprises', 'enterprise_id');
CREATE TRIGGER queue_entries_edition_inherit BEFORE INSERT ON public.queue_entries
  FOR EACH ROW EXECUTE FUNCTION public.edition_inherit_from_parent('challenges', 'challenge_id');
CREATE TRIGGER activities_edition_inherit BEFORE INSERT ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.edition_inherit_from_parent('schedule', 'schedule_id');
CREATE TRIGGER diary_entries_edition_inherit BEFORE INSERT ON public.diary_entries
  FOR EACH ROW EXECUTE FUNCTION public.edition_inherit_from_parent('enterprises', 'enterprise_id');
CREATE TRIGGER activity_rsvps_edition_inherit BEFORE INSERT ON public.activity_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.edition_inherit_from_parent('activities', 'activity_id');
CREATE TRIGGER activity_rsvp_settings_edition_inherit BEFORE INSERT ON public.activity_rsvp_settings
  FOR EACH ROW EXECUTE FUNCTION public.edition_inherit_from_parent('activities', 'activity_id');

-- The automatic per-challenge queue group lives in the challenge's edition.
CREATE OR REPLACE FUNCTION public.challenge_default_queue_group() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  new_group integer;
BEGIN
  INSERT INTO queue_groups (enterprise_id, display_name, event_key)
  SELECT s.enterprise_id, NEW.title, NEW.event_key
    FROM sponsors s
   WHERE s.id = NEW.author
  RETURNING id INTO new_group;

  INSERT INTO queue_group_challenges (queue_group_id, challenge_id)
  VALUES (new_group, NEW.id);

  RETURN NULL;
END;
$$;

-- Helper profiles: one per person and edition (H61); children follow it.
ALTER TABLE public.helper_topics DROP CONSTRAINT helper_topics_user_id_fkey;
ALTER TABLE public.helper_profile_challenges DROP CONSTRAINT helper_profile_challenges_user_id_fkey;
ALTER TABLE public.helper_availability DROP CONSTRAINT helper_availability_user_id_fkey;
ALTER TABLE public.helper_profiles DROP CONSTRAINT helper_profiles_pkey;
ALTER TABLE public.helper_profiles ADD PRIMARY KEY (user_id, event_key);
ALTER TABLE public.helper_topics DROP CONSTRAINT helper_topics_pkey;
ALTER TABLE public.helper_topics ADD PRIMARY KEY (user_id, event_key, topic_id);
ALTER TABLE public.helper_profile_challenges DROP CONSTRAINT helper_profile_challenges_pkey;
ALTER TABLE public.helper_profile_challenges ADD PRIMARY KEY (user_id, event_key, challenge_id);
ALTER TABLE public.helper_topics ADD CONSTRAINT helper_topics_profile_fkey
  FOREIGN KEY (user_id, event_key) REFERENCES public.helper_profiles(user_id, event_key) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.helper_profile_challenges ADD CONSTRAINT helper_profile_challenges_profile_fkey
  FOREIGN KEY (user_id, event_key) REFERENCES public.helper_profiles(user_id, event_key) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.helper_availability ADD CONSTRAINT helper_availability_profile_fkey
  FOREIGN KEY (user_id, event_key) REFERENCES public.helper_profiles(user_id, event_key) ON DELETE CASCADE ON UPDATE CASCADE;

-- Tickets: one per person and edition (H28); the token stays globally unique.
ALTER TABLE public.tickets DROP CONSTRAINT tickets_pkey;
ALTER TABLE public.tickets ADD PRIMARY KEY (user_id, event_key);

-- Certificates (H24): hours approval per person and edition.
ALTER TABLE public.certificate_approvals DROP CONSTRAINT certificate_approvals_pkey;
ALTER TABLE public.certificate_approvals ADD PRIMARY KEY (user_id, event_key);
DROP INDEX public.attendance_certificates_one_live;
CREATE UNIQUE INDEX attendance_certificates_one_live ON public.attendance_certificates
  (user_id, event_key, type_id, locale, activity_name) WHERE revoked_at IS NULL AND superseded_at IS NULL;

-- Revocations (H23, H54) apply to the edition they were made in, so a code
-- reassigned in a later edition is not rejected by an older revocation.
ALTER TABLE public.scanner_revoked_badges DROP CONSTRAINT scanner_revoked_badges_pkey;
ALTER TABLE public.scanner_revoked_badges ADD PRIMARY KEY (credential_digest, event_key);
ALTER TABLE public.scanner_revoked_tickets DROP CONSTRAINT scanner_revoked_tickets_pkey;
ALTER TABLE public.scanner_revoked_tickets ADD PRIMARY KEY (credential_digest, event_key);

-- Diary (#diary): one entry per owner and person per edition.
DROP INDEX public.diary_entries_owner_person;
CREATE UNIQUE INDEX diary_entries_owner_person ON public.diary_entries
  (owner_id, target_user_id, event_key) WHERE target_user_id IS NOT NULL;

-- Help requests (H64): one active request per person and edition.
DROP INDEX public.help_requests_active_requester;
CREATE UNIQUE INDEX help_requests_active_requester ON public.help_requests (requester_id, event_key)
  WHERE status IN ('open', 'claimed') AND requester_id IS NOT NULL;

-- Wallet passes (H28): one live pass per person, purpose and platform per edition.
DROP INDEX public.wallet_passes_one_active_user_purpose_platform;
CREATE UNIQUE INDEX wallet_passes_one_active_user_purpose_platform ON public.wallet_passes
  (user_id, event_key, purpose, platform) WHERE status <> 'voided';

-- Attendance kind per user and edition, derived from that edition's roles,
-- confirmed applications and enterprise membership (no second source).
CREATE VIEW public.event_attendance_kinds AS
SELECT u.id AS user_id, e.event_key,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
      WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.attendance_kind = 'participant' AND a.event_key = e.event_key)
      OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND ur.event_key = e.event_key AND r.name = 'Participant' AND r.deleted_at IS NULL)
      THEN 'participant'
    WHEN EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
      WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.attendance_kind = 'mentor' AND a.event_key = e.event_key)
      OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND ur.event_key = e.event_key AND r.name = 'Mentor' AND r.deleted_at IS NULL)
      THEN 'mentor'
    WHEN EXISTS (SELECT 1 FROM public.sponsors s JOIN public.enterprises en ON en.id = s.enterprise_id
      WHERE s.user_id = u.id AND en.event_key = e.event_key) THEN 'sponsor'
    WHEN EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
      WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.attendance_kind = 'staff' AND a.event_key = e.event_key)
      OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND ur.event_key = e.event_key AND r.event_access AND r.deleted_at IS NULL)
      THEN 'staff'
    ELSE NULL
  END AS kind,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
      WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.attendance_kind = 'participant' AND a.event_key = e.event_key)
      THEN 'confirmed_application'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id AND ur.event_key = e.event_key AND r.name = 'Participant' AND r.deleted_at IS NULL)
      THEN 'attendee_role'
    ELSE 'other'
  END AS evidence
FROM public.users u CROSS JOIN public.editions e
WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
  AND (EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND ur.event_key = e.event_key AND r.event_access AND r.deleted_at IS NULL)
   OR EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
        WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.event_key = e.event_key));

-- Editions a person took part in (GET /api/me/editions): any role in it, any
-- application response, or enterprise membership.
CREATE VIEW public.edition_participation AS
SELECT ur.user_id, ur.event_key, 'role'::text AS source FROM public.user_roles ur WHERE ur.event_key IS NOT NULL
UNION
SELECT ar.user_id, a.event_key, 'application' FROM public.application_responses ar
  JOIN public.applications a ON a.id = ar.application_id WHERE ar.user_id IS NOT NULL
UNION
SELECT s.user_id, en.event_key, 'enterprise' FROM public.sponsors s
  JOIN public.enterprises en ON en.id = s.enterprise_id WHERE s.user_id IS NOT NULL;

-- 5. Badges (H22, H23): a code has one holder at a time and stays globally
-- unique (users.badge_id). The edition of the current assignment decides
-- whether it can be reassigned; the history records the edition of each
-- released assignment.
ALTER TABLE public.users ADD COLUMN badge_event_key text
  REFERENCES public.editions(event_key) ON UPDATE CASCADE;
UPDATE public.users SET badge_event_key = (SELECT event_key FROM public.event_config WHERE id = 1)
 WHERE badge_id IS NOT NULL;
ALTER TABLE public.users ADD CONSTRAINT users_badge_edition_paired
  CHECK ((badge_id IS NULL) = (badge_event_key IS NULL));
-- The assignment trigger (0507) also stamps the edition of each assignment.
CREATE OR REPLACE FUNCTION public.h54_set_badge_assigned_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  client_time timestamptz := nullif(current_setting('hackos.badge_assigned_at', true), '')::timestamptz;
BEGIN
  IF NEW.badge_id IS NULL THEN
    NEW.badge_assigned_at := NULL;
    NEW.badge_event_key := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.badge_id IS DISTINCT FROM OLD.badge_id THEN
    NEW.badge_assigned_at := COALESCE(client_time, clock_timestamp());
    NEW.badge_event_key := public.current_edition();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.badge_id_history (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  badge_id text NOT NULL,
  event_key text NOT NULL DEFAULT public.current_edition()
    REFERENCES public.editions(event_key) ON UPDATE CASCADE,
  released_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id, event_key)
);
CREATE INDEX badge_id_history_badge ON public.badge_id_history (upper(badge_id), event_key);
INSERT INTO public.badge_id_history (user_id, badge_id, event_key)
SELECT u.id, b, (SELECT event_key FROM public.event_config WHERE id = 1)
  FROM public.users u CROSS JOIN LATERAL unnest(u.badge_id_history) AS b
ON CONFLICT DO NOTHING;
ALTER TABLE public.users DROP COLUMN badge_id_history;

-- 6. Anonymous retention (H54): which editions an anonymous participant took
-- part in, with guaranteed presence per edition. Still no mapping to a person.
CREATE TABLE public.anonymous_participant_editions (
  anonymous_participant_id uuid NOT NULL REFERENCES public.anonymous_participants(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES public.editions(event_key) ON UPDATE CASCADE,
  guaranteed_presence_minutes integer NOT NULL DEFAULT 0 CHECK (guaranteed_presence_minutes >= 0),
  PRIMARY KEY (anonymous_participant_id, event_key)
);
INSERT INTO public.anonymous_participant_editions (anonymous_participant_id, event_key, guaranteed_presence_minutes)
SELECT id, (SELECT event_key FROM public.event_config WHERE id = 1), guaranteed_presence_minutes
  FROM public.anonymous_participants;

-- 7. Accepted-spot certificates follow event access in their own edition and
-- never touch a closed edition (#1083).
CREATE OR REPLACE FUNCTION public.certificate_revoke_lost_access(p_user integer) RETURNS void
  LANGUAGE sql AS $$
  WITH revoked AS (
    UPDATE attendance_certificates c
       SET revoked_at = now(), revoked_reason = 'event_access_lost'
     WHERE c.revoked_at IS NULL AND c.user_id IS NOT NULL
       AND (p_user IS NULL OR c.user_id = p_user)
       AND c.type_id = (SELECT id FROM certificate_types WHERE legacy_variant = 'accepted_spot')
       AND EXISTS (SELECT 1 FROM editions e WHERE e.event_key = c.event_key AND e.status <> 'closed')
       AND NOT EXISTS (
         SELECT 1 FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           JOIN users u ON u.id = ur.user_id
          WHERE ur.user_id = c.user_id AND r.event_access AND r.deleted_at IS NULL
            AND u.account_state = 'active' AND u.anonymized_at IS NULL
            AND (ur.event_key IS NULL OR ur.event_key = c.event_key))
    RETURNING c.id
  )
  INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, reason)
  SELECT NULL, 'attendance_certificate', id::text, 'certificate.revoke', 'system', 'event_access_lost'
    FROM revoked;
$$;

-- 8. Write guard on every edition-owned root table --------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_roles', 'applications', 'mentor_profiles', 'onboarding_step_states',
    'activity_rsvps', 'activity_rsvp_settings', 'enterprises', 'challenges', 'repos',
    'rooms', 'queue_groups', 'queue_entries', 'schedule', 'activities', 'announcements',
    'help_requests', 'helpdesk_open_windows', 'helper_profiles', 'helper_topics',
    'helper_profile_challenges', 'helper_availability', 'tickets', 'check_in_logs',
    'time_logs', 'wallet_passes', 'diary_entries', 'attendance_certificates',
    'certificate_approvals'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.edition_write_guard()',
      t || '_edition_write_guard', t);
  END LOOP;
END $$;
