-- DELTA(HackUDC 2027 onboarding) vs plan/schema-boceto.dbml: edition-scoped onboarding,
-- attendance classification, helper publication and activity RSVP. This task has no H-number.
ALTER TABLE public.event_config
  ADD COLUMN event_key text NOT NULL DEFAULT 'default' CHECK (event_key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  ADD COLUMN onboarding_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN onboarding_revision integer NOT NULL DEFAULT 1 CHECK (onboarding_revision > 0);
ALTER TABLE public.applications
  ADD COLUMN event_key text,
  ADD COLUMN attendance_kind text NOT NULL DEFAULT 'participant' CHECK (attendance_kind IN ('participant','mentor','staff'));
UPDATE public.applications SET event_key = (SELECT event_key FROM public.event_config WHERE id = 1);
ALTER TABLE public.applications ALTER COLUMN event_key SET NOT NULL;
ALTER TABLE public.applications ALTER COLUMN event_key SET DEFAULT 'default';
-- Event-scoped evidence records every role assignment attempt, including a
-- repeated ON CONFLICT DO NOTHING grant in a later edition. It is evidence of
-- a grant, not an editable attendance-kind field.
CREATE TABLE public.user_role_event_evidence (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,role_id,event_key)
);
INSERT INTO public.user_role_event_evidence (user_id,role_id,event_key,assigned_at)
SELECT ur.user_id,ur.role_id,e.event_key,ur.assigned_at
FROM public.user_roles ur CROSS JOIN public.event_config e;
CREATE FUNCTION public.record_role_event_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.user_role_event_evidence (user_id,role_id,event_key)
  VALUES (NEW.user_id,NEW.role_id,
    COALESCE((SELECT event_key FROM public.event_config WHERE id=1),'default'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER user_roles_event_evidence BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.record_role_event_evidence();

ALTER TABLE public.role_capabilities DROP CONSTRAINT role_capabilities_known_catalogue;
ALTER TABLE public.role_capabilities ADD CONSTRAINT role_capabilities_known_catalogue
  CHECK (capability = ANY (ARRAY[
    '*','users:read','users:write','permissions:manage','invites:manage',
    'applications:manage','applications:review','applications:decide',
    'applications:confirm-override','applications:edit-response','statistics:manage',
    'projects:read','projects:import','projects:edit','accredit:scan','presence:scan',
    'activity:scan','logistics:stats','intolerances:manage','meal-plans:export',
    'meal-plans:manage','queue:status','queue:operate','queue:admin','judge:panel',
    'judging:export','sponsors:manage','challenges:manage','schedule:read',
    'schedule:manage','announcements:manage','tv:control','notifications:send',
    'audit:read','exports:run','event:manage','venue:manage','wallet:manage',
    'presence:manage','helpdesk:offer'
  ]));
INSERT INTO public.role_capabilities (role_id, capability, state)
SELECT id, 'helpdesk:offer', 'allow'::public.permission_state FROM public.roles
WHERE is_seeded AND deleted_at IS NULL AND name IN ('Mentor','Sponsor','Organizer','Day Staff','Event Director')
ON CONFLICT DO NOTHING;
UPDATE public.role_seed_defaults d SET capabilities = d.capabilities || '{"helpdesk:offer":"allow"}'::jsonb
FROM public.roles r WHERE r.id = d.role_id AND r.is_seeded AND r.deleted_at IS NULL
AND r.name IN ('Mentor','Sponsor','Organizer','Day Staff','Event Director');

CREATE VIEW public.event_attendance_kinds AS
SELECT u.id AS user_id, e.event_key,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
      WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.attendance_kind = 'participant'
        AND a.event_key = e.event_key)
      OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        JOIN public.user_role_event_evidence ev ON ev.user_id=ur.user_id AND ev.role_id=ur.role_id
        WHERE ur.user_id = u.id AND ev.event_key = e.event_key AND r.name = 'Participant' AND r.deleted_at IS NULL)
      THEN 'participant'
    WHEN EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
      WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.attendance_kind = 'mentor'
        AND a.event_key = e.event_key)
      OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        JOIN public.user_role_event_evidence ev ON ev.user_id=ur.user_id AND ev.role_id=ur.role_id
        WHERE ur.user_id = u.id AND ev.event_key = e.event_key AND r.name = 'Mentor' AND r.deleted_at IS NULL)
      THEN 'mentor'
    WHEN EXISTS (SELECT 1 FROM public.sponsors s WHERE s.user_id = u.id) THEN 'sponsor'
    WHEN EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
      WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.attendance_kind = 'staff'
        AND a.event_key = e.event_key)
      OR EXISTS (SELECT 1 FROM public.user_event_access ea
        JOIN public.user_roles ur ON ur.user_id = ea.user_id
        JOIN public.roles access_role ON access_role.id=ur.role_id AND access_role.event_access AND access_role.deleted_at IS NULL
        JOIN public.user_role_event_evidence ev ON ev.user_id=ur.user_id AND ev.role_id=ur.role_id
        WHERE ea.user_id = u.id AND ev.event_key=e.event_key)
      THEN 'staff'
    ELSE NULL
  END AS kind,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id = ar.application_id
      WHERE ar.user_id = u.id AND ar.status = 'confirmed' AND a.attendance_kind = 'participant'
        AND a.event_key = e.event_key) THEN 'confirmed_application'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      JOIN public.user_role_event_evidence ev ON ev.user_id=ur.user_id AND ev.role_id=ur.role_id
      WHERE ur.user_id = u.id AND ev.event_key = e.event_key AND r.name = 'Participant' AND r.deleted_at IS NULL) THEN 'attendee_role'
    ELSE 'other'
  END AS evidence
FROM public.users u CROSS JOIN public.event_config e
WHERE EXISTS (SELECT 1 FROM public.user_event_access ea
  JOIN public.user_roles ur ON ur.user_id=ea.user_id
  JOIN public.roles access_role ON access_role.id=ur.role_id AND access_role.event_access AND access_role.deleted_at IS NULL
  JOIN public.user_role_event_evidence ev ON ev.user_id=ur.user_id AND ev.role_id=ur.role_id
  WHERE ea.user_id = u.id AND ev.event_key=e.event_key)
   OR EXISTS (SELECT 1 FROM public.application_responses ar JOIN public.applications a ON a.id=ar.application_id
      WHERE ar.user_id=u.id AND ar.status = 'confirmed' AND a.event_key=e.event_key);

CREATE TABLE public.onboarding_step_states (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  step text NOT NULL CHECK (step IN ('welcome','profile','dietary','networking','mentor_profile','rsvp','notifications','share','completion')),
  status text NOT NULL CHECK (status IN ('completed','skipped','deferred','declined')),
  deferred_until timestamptz,
  config_revision integer NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,event_key,step),
  CHECK ((status = 'deferred') = (deferred_until IS NOT NULL))
);
CREATE TRIGGER onboarding_step_states_updated_at BEFORE UPDATE ON public.onboarding_step_states
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.mentor_profiles (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,event_key)
);
CREATE TRIGGER mentor_profiles_updated_at BEFORE UPDATE ON public.mentor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.form_libraries ADD COLUMN profile boolean NOT NULL DEFAULT false;
ALTER TABLE public.form_libraries DROP CONSTRAINT form_libraries_check;
ALTER TABLE public.form_libraries ADD CONSTRAINT form_libraries_scope_check
  CHECK (num_nonnulls(application_id) + project::integer + profile::integer = 1);
CREATE UNIQUE INDEX form_libraries_profile_field ON public.form_libraries(field_key) WHERE profile;
INSERT INTO public.form_libraries (id,application_id,project,profile,field_key)
VALUES ('ad2f5017-6fc0-4ae8-9289-1de06c86e4bd',NULL,false,true,'mentor_expertise')
ON CONFLICT DO NOTHING;
CREATE TABLE public.mentor_profile_expertise (
  user_id integer NOT NULL,
  event_key text NOT NULL,
  library_value_id integer NOT NULL REFERENCES public.form_library_values(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id,event_key,library_value_id),
  FOREIGN KEY (user_id,event_key) REFERENCES public.mentor_profiles(user_id,event_key) ON DELETE CASCADE
);

CREATE TABLE public.activity_rsvp_settings (
  activity_id integer NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  required boolean NOT NULL DEFAULT false,
  kinds text[] NOT NULL DEFAULT '{}' CHECK (kinds <@ ARRAY['participant','mentor','sponsor','staff']::text[]),
  name_i18n jsonb,
  description_i18n jsonb,
  rsvp_date timestamptz,
  closes_at timestamptz,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id,event_key),
  CHECK (NOT required OR enabled)
);
CREATE TRIGGER activity_rsvp_settings_updated_at BEFORE UPDATE ON public.activity_rsvp_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TABLE public.activity_rsvps (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  activity_id integer NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  attending boolean,
  option_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,activity_id,event_key),
  CHECK (attending IS TRUE OR option_key IS NULL)
);
CREATE INDEX activity_rsvps_activity_answer ON public.activity_rsvps(activity_id,event_key,attending);
CREATE TRIGGER activity_rsvps_updated_at BEFORE UPDATE ON public.activity_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- Existing sponsor meal answers become current-edition RSVP answers. A row with
-- attending NULL is the distinct explicit "unsure" answer; no row is unanswered.
INSERT INTO public.activity_rsvp_settings (activity_id,event_key,enabled,kinds)
SELECT DISTINCT offered.activity_id,e.event_key,true,ARRAY['sponsor']::text[]
FROM (
  SELECT a.id AS activity_id FROM public.activities a
  JOIN public.schedule sc ON sc.id = a.schedule_id
  WHERE a.category = 'meal' AND sc.visibility = 'shown' AND sc.ends_at > now()
    AND 'sponsor' = ANY(sc.audiences)
  UNION
  SELECT activity_id FROM public.meal_attendance_plans
) offered CROSS JOIN public.event_config e
ON CONFLICT DO NOTHING;
INSERT INTO public.activity_rsvps (user_id,activity_id,event_key,attending,created_at,updated_at)
SELECT p.user_id,p.activity_id,e.event_key,p.attending,p.created_at,p.updated_at
FROM public.meal_attendance_plans p CROSS JOIN public.event_config e
ON CONFLICT DO NOTHING;
DROP TABLE public.meal_attendance_plans;
