-- 0104_capability_catalogue_guard.sql — DELTA(H8, H53): quarantine unknown
-- grants before enforcing the shared capability catalogue at the database edge.
-- `sponsor:portal` remains a known, migration-compatible no-op and is therefore
-- deliberately not quarantined.

CREATE TABLE capability_grant_quarantine (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id integer NOT NULL,
  capability text NOT NULL,
  reason text NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE capability_grant_quarantine IS
  'H8/H53 repair queue for grants outside packages/shared/src/capabilities.ts; these grants never participate in authorization.';

-- DELTA(H8): preserved compatibility inventory. `sponsor:portal` is a known
-- deprecated no-op, so existing assignments remain intact but are visible to
-- administrators for a deliberate later repair/removal decision.
CREATE VIEW deprecated_sponsor_portal_assignments AS
SELECT gc.group_id,
       pg.name AS group_name,
       pg.description AS group_description,
       COUNT(pgm.user_id)::integer AS member_count,
       array_remove(array_agg(pgm.user_id ORDER BY pgm.user_id), NULL) AS user_ids
  FROM group_capabilities gc
  JOIN permission_groups pg ON pg.id = gc.group_id
  LEFT JOIN permission_group_members pgm ON pgm.group_id = gc.group_id
 WHERE gc.capability = 'sponsor:portal'
 GROUP BY gc.group_id, pg.name, pg.description;

COMMENT ON VIEW deprecated_sponsor_portal_assignments IS
  'Compatibility report for deprecated no-op sponsor:portal grants; assignments are retained, never effective authorization.';

INSERT INTO capability_grant_quarantine (group_id, capability, reason)
SELECT group_id, capability, 'unknown_capability_catalogue'
FROM group_capabilities
WHERE capability <> ALL (
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
    'exports:run'
  ]::text[]
);

DELETE FROM group_capabilities
WHERE capability <> ALL (
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
    'exports:run'
  ]::text[]
);

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
        'exports:run'
      ]::text[]
    )
  );
