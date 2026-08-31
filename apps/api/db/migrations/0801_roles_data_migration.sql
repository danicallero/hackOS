-- 0801_roles_data_migration.sql — DELTA(H8): cutover data copy. This is a
-- true DATA migration, not a seed: it only carries over template-origin
-- roles for H8 platform templates (src/modules/identity/templates.ts) that
-- some pre-existing `permission_groups` row actually instantiated
-- (`template_key` set — 0105) in whatever installation this migration runs
-- against. A fresh install has zero `permission_groups` rows, so this step
-- creates zero roles there; 0805 alone provides the fresh-install default
-- set. An install upgrading from the old capability-group model gets a role
-- for exactly the templates it actually provisioned, migrates every
-- permission_group_members row onto the equivalent role(s), creates a
-- bespoke role for any custom/ad-hoc group that isn't a clean template
-- instance (carrying over its exact effective — recursively-expanded —
-- capability set as ALLOW so no user loses access), and adds the Sponsor
-- auto-grant role + its role_grant_rules row (replaces the sponsor
-- auto-link-grants-access behavior, wired in application code via
-- lib/role-grants.ts) — Sponsor is always created, template-usage or not,
-- since it isn't a template port at all but a new mechanism.
--
-- Every migrated capability lands as ALLOW, never DENY — the old model was
-- purely additive (union of group capabilities), so regardless of the
-- position this migration assigns a role, no combination of migrated roles
-- can deny a capability a user previously held (DENY did not exist).

-- ── 1. the 20 platform templates become named, ALLOW-only roles, but only
--        the ones some pre-existing permission_groups row actually used ────
-- Positions are spaced widely (500-1000 apart) so future roles can be
-- inserted between any two without a bulk renumber.

CREATE TEMP TABLE _h8_all_templates (
  role_name text PRIMARY KEY,
  template_key text UNIQUE NOT NULL,
  position integer NOT NULL,
  is_visible boolean NOT NULL,
  is_protected boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO _h8_all_templates (role_name, template_key, position, is_visible, is_protected) VALUES
  ('Platform administrator',    'platform-administrator',    19000, true, true),
  ('Access administrator',      'access-administrator',      18000, true, false),
  ('Application supervisor',    'application-supervisor',    17500, true, false),
  ('Application decisions',     'application-decisions',     17400, true, false),
  ('Application reviewer',      'application-reviewer',      17300, true, false),
  ('Application builder',       'application-builder',       17200, true, false),
  ('Judging administrator',     'judging-administrator',     17000, true, false),
  ('Queue operator',            'queue-operator',             16500, true, false),
  ('Project operator',          'project-operator',           16000, true, false),
  ('Logistics supervisor',      'logistics-supervisor',       15500, true, false),
  ('Accreditation station',     'accreditation-station',      15400, true, false),
  ('Presence station',          'presence-station',           15300, true, false),
  ('Activity and meal station', 'activity-and-meal-station',  15200, true, false),
  ('Programme manager',         'programme-manager',          15000, true, false),
  ('Event settings manager',    'event-settings-manager',     14500, true, false),
  ('TV operator',               'tv-operator',                14000, true, false),
  ('Sponsor administrator',     'sponsor-administrator',      13500, true, false),
  ('Communications manager',    'communications-manager',     13000, true, false),
  ('Data auditor',              'data-auditor',                12500, true, false),
  ('Content library manager',   'content-library-manager',    12000, true, false);

INSERT INTO roles (name, position, is_visible, is_protected)
SELECT t.role_name, t.position, t.is_visible, t.is_protected
FROM _h8_all_templates t
WHERE EXISTS (
  SELECT 1 FROM permission_groups pg WHERE pg.template_key = t.template_key
);

INSERT INTO role_capabilities (role_id, capability, state)
SELECT r.id, cap, 'allow'::permission_state
FROM roles r
JOIN (VALUES
  ('Platform administrator',    ARRAY['*']),
  ('Access administrator',      ARRAY['users:read','users:write','permissions:manage','invites:manage','audit:read']),
  ('Application builder',       ARRAY['applications:manage']),
  ('Application reviewer',      ARRAY['applications:review']),
  ('Application decisions',     ARRAY['applications:review','applications:decide']),
  ('Application supervisor',    ARRAY['applications:manage','applications:review','applications:decide','applications:confirm-override','applications:edit-response']),
  ('Project operator',          ARRAY['projects:read','projects:import','projects:edit']),
  ('Queue operator',            ARRAY['projects:read','queue:operate','judging:export']),
  ('Judging administrator',     ARRAY['projects:read','queue:operate','queue:admin','judge:panel','judging:export']),
  ('Accreditation station',     ARRAY['accredit:scan']),
  ('Presence station',          ARRAY['presence:scan']),
  ('Activity and meal station', ARRAY['activity:scan']),
  ('Logistics supervisor',      ARRAY['accredit:scan','presence:scan','activity:scan','logistics:stats']),
  ('Programme manager',         ARRAY['schedule:manage']),
  ('Event settings manager',    ARRAY['event:manage','venue:manage','wallet:manage','presence:manage']),
  ('TV operator',               ARRAY['tv:control']),
  ('Sponsor administrator',     ARRAY['sponsors:manage','invites:manage','users:read']),
  ('Communications manager',    ARRAY['announcements:manage','notifications:send']),
  ('Data auditor',              ARRAY['audit:read','exports:run','users:read']),
  ('Content library manager',   ARRAY['intolerances:manage'])
) AS templates(role_name, capabilities) ON templates.role_name = r.name
CROSS JOIN LATERAL unnest(templates.capabilities) AS cap;

-- template_key -> canonical role name, used both to migrate memberships and
-- (further down) to skip these groups when hunting for custom/ad-hoc ones.
-- Scoped to templates that actually got a role in step 1 above (i.e. some
-- permission_groups row used them) — a template_key with no matching role
-- would just find nothing to migrate in step 2, but leaving it out keeps
-- step 3's "clean template-origin vs custom" check exact.
CREATE TEMP TABLE _h8_template_role_map (template_key text PRIMARY KEY, role_name text) ON COMMIT DROP;
INSERT INTO _h8_template_role_map (template_key, role_name)
SELECT t.template_key, t.role_name
FROM _h8_all_templates t
JOIN roles r ON r.name = t.role_name;

-- ── 2. clean template-origin groups: map members onto the matching role ────

INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at, source)
SELECT DISTINCT pgm.user_id, r.id, pgm.assigned_by, pgm.assigned_at, 'migration'
FROM permission_group_members pgm
JOIN permission_groups pg ON pg.id = pgm.group_id
JOIN _h8_template_role_map map ON map.template_key = pg.template_key
JOIN roles r ON r.name = map.role_name
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ── 3. custom/ad-hoc groups (no template_key, or one no longer known):
--        one bespoke role each, carrying the group's exact effective
--        (recursively-expanded through includes) capability set as ALLOW.
--        Position is a unique negative slot derived from the group id, well
--        below every template role and the Sponsor auto-grant role, so it
--        never collides and its relative order among other custom groups is
--        immaterial (see note above: ALLOW-only migration is order-safe).

INSERT INTO roles (name, position, is_visible, is_protected)
SELECT pg.name || ' (migrated)', -(1000 + pg.id), true, false
FROM permission_groups pg
WHERE pg.template_key IS NULL
   OR pg.template_key NOT IN (SELECT template_key FROM _h8_template_role_map);

INSERT INTO role_capabilities (role_id, capability, state)
SELECT r.id, caps.capability, 'allow'::permission_state
FROM roles r
CROSS JOIN LATERAL (
  WITH RECURSIVE effective_groups(group_id) AS (
    SELECT (-r.position - 1000)::integer
    UNION
    SELECT pgi.child_group_id
    FROM permission_group_includes pgi
    JOIN effective_groups eg ON eg.group_id = pgi.parent_group_id
  )
  SELECT DISTINCT gc.capability
  FROM group_capabilities gc
  JOIN effective_groups eg ON eg.group_id = gc.group_id
) AS caps
WHERE r.position < -1000;

INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at, source)
SELECT DISTINCT pgm.user_id, r.id, pgm.assigned_by, pgm.assigned_at, 'migration'
FROM permission_group_members pgm
JOIN roles r ON r.position = -(1000 + pgm.group_id)
WHERE r.position < -1000
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ── 4. Sponsor auto-grant role: replaces the sponsor auto-link-grants-access
--        behavior (invites.ts accept flow, sponsors/service.ts
--        addEnterpriseMember) via the generic role_grant_rules mechanism.
--        Carries no capabilities of its own — sponsor portal access is a
--        relationship (the `sponsors` table), not a capability grant.

INSERT INTO roles (name, position, is_visible, is_protected, is_seeded) VALUES ('Sponsor', 1000, true, false, true);

INSERT INTO role_grant_rules (role_id, trigger_event, action, enabled)
SELECT id, 'sponsor.enterprise_linked', 'grant', true FROM roles WHERE name = 'Sponsor';

-- Symmetric revoke: fired once a user's last enterprise affiliation is
-- removed (sponsors/service.ts's removeEnterpriseMember).
INSERT INTO role_grant_rules (role_id, trigger_event, action, enabled)
SELECT id, 'sponsor.enterprise_unlinked', 'revoke', true FROM roles WHERE name = 'Sponsor';

-- Backfill: every user already linked to an enterprise gets the Sponsor role
-- too, so migration doesn't regress the enterprise-membership-implies-access
-- behavior for accounts that predate this cutover.
INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at, source)
SELECT DISTINCT s.user_id, r.id, NULL::integer, now(), 'sponsor.enterprise_linked'
FROM sponsors s
CROSS JOIN roles r
WHERE r.name = 'Sponsor'
ON CONFLICT (user_id, role_id) DO NOTHING;
