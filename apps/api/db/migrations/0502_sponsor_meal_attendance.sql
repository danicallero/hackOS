-- #933: sponsor meal attendance plans and explicit dietary confirmation.
--
-- DELTA(#933) vs plan/schema-boceto.dbml: new table meal_attendance_plans,
-- users.dietary_confirmed_at, users.meal_plan_confirmed_at and
-- event_config.meal_plan_cutoff_hours. The boceto has no notion of planned
-- meal attendance, of a per-event change cutoff, nor of "dietary data
-- explicitly confirmed (possibly empty)": dietary_data_state = 'not_provided'
-- cannot tell "answered: no restrictions" from "never asked".

ALTER TABLE public.users
  ADD COLUMN dietary_confirmed_at timestamp with time zone,
  ADD COLUMN meal_plan_confirmed_at timestamp with time zone;

COMMENT ON COLUMN public.users.dietary_confirmed_at IS
  '#933: last explicit dietary answer (an empty answer counts). NULL drives the dietary pending profile task.';
COMMENT ON COLUMN public.users.meal_plan_confirmed_at IS
  '#933: first time the sponsor submitted their meal plan.';

-- Anyone with dietary data already answered the question, and so did anyone
-- who submitted an application whose form asked for it (an empty answer there
-- means "no restrictions"), mirroring submitResponse.
UPDATE public.users u SET dietary_confirmed_at = now()
 WHERE u.dietary_data_state = 'present'
    OR EXISTS (
      SELECT 1
        FROM public.application_responses r
        JOIN public.applications a ON a.id = r.application_id
       WHERE r.user_id = u.id
         AND r.submitted_at IS NOT NULL
         AND a.ask_food_intolerances);

ALTER TABLE public.event_config
  ADD COLUMN meal_plan_cutoff_hours integer DEFAULT 24 NOT NULL,
  ADD CONSTRAINT event_config_meal_plan_cutoff_hours_range
    CHECK (meal_plan_cutoff_hours >= 0 AND meal_plan_cutoff_hours <= 168);

COMMENT ON COLUMN public.event_config.meal_plan_cutoff_hours IS
  '#933: meal plans lock this many hours before each meal starts.';

-- One row per (user, offered meal) with an explicit answer, so "not going"
-- differs from "has not answered". Meal eligibility (meal kind + sponsor
-- audience) is validated by the service, not the database.
CREATE TABLE public.meal_attendance_plans (
    user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    activity_id integer NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    attending boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, activity_id)
);

COMMENT ON TABLE public.meal_attendance_plans IS
  '#933: personal meal plan of a sponsor; deleted with the account (H54).';

CREATE INDEX meal_attendance_plans_activity_idx
  ON public.meal_attendance_plans (activity_id) WHERE attending;

CREATE TRIGGER meal_attendance_plans_updated_at
  BEFORE UPDATE ON public.meal_attendance_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- H8: extend the closed capability catalogue with the two new capabilities.
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
    'schedule:manage'::text, 'announcements:manage'::text, 'tv:control'::text,
    'notifications:send'::text, 'audit:read'::text, 'exports:run'::text,
    'event:manage'::text, 'venue:manage'::text, 'wallet:manage'::text,
    'presence:manage'::text])));

-- Seed onto the seeded Event Director (holds the whole catalogue) and
-- Operations Team (owns logistics and the intolerance dictionary) roles.
-- Roles an operator deleted or renamed away from the seed are left alone.
INSERT INTO public.role_capabilities (role_id, capability, state)
SELECT r.id, cap.capability, 'allow'::public.permission_state
  FROM public.roles r
 CROSS JOIN (VALUES ('meal-plans:export'), ('meal-plans:manage')) AS cap(capability)
 WHERE r.is_seeded AND r.deleted_at IS NULL
   AND r.name IN ('Event Director', 'Operations Team')
ON CONFLICT DO NOTHING;

UPDATE public.role_seed_defaults d
   SET capabilities = d.capabilities
     || '{"meal-plans:export": "allow", "meal-plans:manage": "allow"}'::jsonb
  FROM public.roles r
 WHERE r.id = d.role_id
   AND r.is_seeded AND r.deleted_at IS NULL
   AND r.name IN ('Event Director', 'Operations Team');
