-- 0819_queue_status_capability.sql — H38: stable permission for the personal queue surface.
--
-- Queue navigation must not infer a participant from a display role name. Any
-- custom role can receive this capability through the permissions UI, while
-- the seeded Participant role gets it as the initial default. The role name is
-- used only once here to identify that seed during migration; runtime code
-- checks the durable capability grant instead.

ALTER TABLE role_capabilities DROP CONSTRAINT role_capabilities_known_catalogue;
ALTER TABLE role_capabilities ADD CONSTRAINT role_capabilities_known_catalogue CHECK (
  capability = ANY (ARRAY[
    '*', 'users:read', 'users:write', 'permissions:manage', 'invites:manage',
    'applications:manage', 'applications:review', 'applications:decide',
    'applications:confirm-override', 'applications:edit-response', 'statistics:manage',
    'projects:read', 'projects:import', 'projects:edit', 'accredit:scan', 'presence:scan',
    'activity:scan', 'logistics:stats', 'intolerances:manage', 'queue:status',
    'queue:operate', 'queue:admin', 'judge:panel', 'judging:export', 'sponsors:manage',
    'sponsor:portal', 'challenges:manage', 'schedule:manage', 'announcements:manage',
    'tv:control', 'notifications:send', 'audit:read', 'exports:run', 'event:manage',
    'venue:manage', 'wallet:manage', 'presence:manage'
  ]::text[])
);

INSERT INTO role_capabilities (role_id, capability, state)
SELECT r.id, 'queue:status', 'allow'::permission_state
  FROM roles r
 WHERE r.name IN ('Event Director', 'Participant')
   AND r.is_seeded
ON CONFLICT (role_id, capability) DO NOTHING;

-- Seeded-role reset must keep the new default instead of treating it as drift.
UPDATE role_seed_defaults rsd
   SET capabilities = rsd.capabilities || jsonb_build_object('queue:status', 'allow')
  FROM roles r
 WHERE r.id = rsd.role_id
   AND r.name IN ('Event Director', 'Participant')
   AND r.is_seeded;
