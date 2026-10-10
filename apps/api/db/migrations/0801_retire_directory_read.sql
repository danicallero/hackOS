-- #935 (DELTA vs plan/schema-boceto.dbml, H8 capability catalogue): retire
-- `directory:read`. The browsable people directory (#934) is gone; people
-- enter an attendee's event diary only by scanning their badge or ticket, and
-- a public profile is readable only by the attendees who saved that person.
-- The capability no longer gates anything, so its grants, its seeded-role
-- defaults and its catalogue entry are removed.

DELETE FROM public.role_capabilities WHERE capability = 'directory:read';

-- Seeded-role reset must not bring the retired grant back.
UPDATE public.role_seed_defaults
   SET capabilities = capabilities - 'directory:read'
 WHERE capabilities ? 'directory:read';

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
