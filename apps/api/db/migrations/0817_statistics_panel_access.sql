-- 0817_statistics_panel_access.sql — DELTA(H27): dynamic per-panel stats ACL.
ALTER TABLE role_capabilities DROP CONSTRAINT role_capabilities_known_catalogue;
ALTER TABLE role_capabilities ADD CONSTRAINT role_capabilities_known_catalogue CHECK (
  capability = ANY (ARRAY[
    '*', 'users:read', 'users:write', 'permissions:manage', 'invites:manage',
    'applications:manage', 'applications:review', 'applications:decide',
    'applications:confirm-override', 'applications:edit-response', 'statistics:manage',
    'projects:read', 'projects:import', 'projects:edit', 'accredit:scan', 'presence:scan',
    'activity:scan', 'logistics:stats', 'intolerances:manage', 'queue:operate', 'queue:admin',
    'judge:panel', 'judging:export', 'sponsors:manage', 'sponsor:portal', 'challenges:manage',
    'schedule:manage', 'announcements:manage', 'tv:control', 'notifications:send', 'audit:read',
    'exports:run', 'event:manage', 'venue:manage', 'wallet:manage', 'presence:manage'
  ]::text[])
);

CREATE TABLE application_stats_panel_role_access (
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  panel_key text NOT NULL CHECK (panel_key ~ '^[a-z0-9:_-]+$'),
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  state permission_state NOT NULL DEFAULT 'inherit',
  PRIMARY KEY (application_id, panel_key, role_id)
);
CREATE INDEX application_stats_panel_role_access_panel_idx ON application_stats_panel_role_access (application_id, panel_key);
COMMENT ON TABLE application_stats_panel_role_access IS 'H27: dynamic panel ACL resolved by role position; no effective allow denies by default.';

INSERT INTO role_capabilities (role_id, capability, state)
SELECT r.id, 'statistics:manage', 'allow'::permission_state FROM roles r
WHERE r.name IN ('Event Director', 'Applications Lead')
ON CONFLICT (role_id, capability) DO UPDATE SET state = EXCLUDED.state;

-- The seeded-role tests and reset-to-default flow treat role_seed_defaults as
-- the complete immutable ALLOW snapshot. Extend the two manager snapshots to
-- include the capability introduced by this migration.
UPDATE role_seed_defaults rsd
SET capabilities = rsd.capabilities || jsonb_build_object('statistics:manage', 'allow')
FROM roles r
WHERE r.id = rsd.role_id
  AND r.name IN ('Event Director', 'Applications Lead');

-- Preserve the existing logistics stats audience for the base panels. Dynamic
-- field panels remain private until explicitly published in Stats.
INSERT INTO application_stats_panel_role_access (application_id, panel_key, role_id, state)
SELECT a.id, p.panel_key, r.id, 'allow'::permission_state
FROM applications a
CROSS JOIN (VALUES ('overview'), ('funnel'), ('shirt-sizes'), ('food-intolerances')) AS p(panel_key)
JOIN roles r ON r.name IN ('Organizer', 'Day Staff', 'Operations Team', 'Logistics supervisor')
ON CONFLICT (application_id, panel_key, role_id) DO NOTHING;
