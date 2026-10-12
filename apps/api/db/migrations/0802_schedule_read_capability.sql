-- H8, H48, H59 (DELTA vs plan/schema-boceto.dbml, H8 capability catalogue):
-- add `schedule:read`, a read-only view of the full event schedule (hidden,
-- unpublished and scheduled entries, staff notes, owners, audiences).
-- `schedule:manage` keeps implying read in the API and clients. Only the
-- seeded Event Director (which holds the whole catalogue) receives it; other
-- roles are granted it explicitly through the permissions UI.

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
    'presence:manage'::text])));

INSERT INTO public.role_capabilities (role_id, capability, state)
SELECT r.id, 'schedule:read', 'allow'::public.permission_state
  FROM public.roles r
 WHERE r.is_seeded AND r.deleted_at IS NULL AND r.name = 'Event Director'
ON CONFLICT DO NOTHING;

UPDATE public.role_seed_defaults d
   SET capabilities = d.capabilities || '{"schedule:read": "allow"}'::jsonb
  FROM public.roles r
 WHERE r.id = d.role_id
   AND r.is_seeded AND r.deleted_at IS NULL AND r.name = 'Event Director';
