-- 0821: remove compatibility-only authorization state.
--
-- 0815 was a controlled rollout bridge for the already-published mobile
-- client. Access is now role-derived everywhere, so the hidden
-- legacy:event-access role must not remain as a second entitlement path.
-- sponsor:portal was likewise a no-op retained only to make old rows
-- inspectable. Neither belongs in the live permission model anymore.

DELETE FROM role_grant_rules
 WHERE role_id IN (SELECT id FROM roles WHERE name = 'legacy:event-access')
    OR source_role_id IN (SELECT id FROM roles WHERE name = 'legacy:event-access');

DELETE FROM application_grants_roles
 WHERE role_id IN (SELECT id FROM roles WHERE name = 'legacy:event-access');

DELETE FROM user_roles
 WHERE role_id IN (SELECT id FROM roles WHERE name = 'legacy:event-access');

DELETE FROM roles
 WHERE name = 'legacy:event-access';

DELETE FROM role_capabilities
 WHERE capability = 'sponsor:portal';

ALTER TABLE role_capabilities DROP CONSTRAINT role_capabilities_known_catalogue;
ALTER TABLE role_capabilities ADD CONSTRAINT role_capabilities_known_catalogue CHECK (
  capability = ANY (ARRAY[
    '*', 'users:read', 'users:write', 'permissions:manage', 'invites:manage',
    'applications:manage', 'applications:review', 'applications:decide',
    'applications:confirm-override', 'applications:edit-response', 'statistics:manage',
    'projects:read', 'projects:import', 'projects:edit', 'accredit:scan', 'presence:scan',
    'activity:scan', 'logistics:stats', 'intolerances:manage', 'queue:status',
    'queue:operate', 'queue:admin', 'judge:panel', 'judging:export', 'sponsors:manage',
    'challenges:manage', 'schedule:manage', 'announcements:manage', 'tv:control',
    'notifications:send', 'audit:read', 'exports:run', 'event:manage', 'venue:manage',
    'wallet:manage', 'presence:manage'
  ]::text[])
);
