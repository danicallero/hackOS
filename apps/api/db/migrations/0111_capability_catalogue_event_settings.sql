-- DELTA(H8, H45, H47): register the four new event-settings capabilities
-- (event:manage, venue:manage, wallet:manage, presence:manage) added to
-- packages/shared/src/capabilities.ts, splitting the former catch-all
-- schedule:manage gate on /api/event. Mirrors 0104's guard: the DB edge must
-- accept exactly the shared catalogue, nothing more.

ALTER TABLE group_capabilities
  DROP CONSTRAINT group_capabilities_known_catalogue;

ALTER TABLE group_capabilities
  ADD CONSTRAINT group_capabilities_known_catalogue CHECK (
    capability = ANY (
      ARRAY[
        '*',
        'users:read', 'users:write', 'permissions:manage', 'invites:manage',
        'applications:manage', 'applications:review', 'applications:decide',
        'applications:confirm-override', 'applications:edit-response',
        'projects:read', 'projects:import', 'projects:edit',
        'accredit:scan', 'presence:scan', 'activity:scan', 'logistics:stats',
        'intolerances:manage', 'queue:operate', 'queue:admin', 'judge:panel',
        'judging:export', 'sponsors:manage', 'sponsor:portal', 'schedule:manage',
        'announcements:manage', 'tv:control', 'notifications:send', 'audit:read',
        'exports:run', 'event:manage', 'venue:manage', 'wallet:manage',
        'presence:manage'
      ]::text[]
    )
  );
