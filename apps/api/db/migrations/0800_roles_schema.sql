-- 0800_roles_schema.sql — DELTA(H8): Discord-style hierarchical roles replace
-- capability groups as the authorization source. A user may hold several
-- roles; roles sit on one global reorderable hierarchy (`position`, higher =
-- more priority); each role holds ALLOW/DENY/INHERIT per capability.
-- Resolution walks the user's own assigned roles ordered by position
-- descending, short-circuiting on the first ALLOW/DENY; INHERIT continues to
-- the next-lower-position role the user also holds (not the global next
-- role); an all-INHERIT chain or no roles denies (plan/07 invariant 13,
-- historias-hackos.md H8).
--
-- permission_groups / group_capabilities / permission_group_includes /
-- permission_group_members are NOT dropped here — 0801 copies their data
-- into the new tables first, and a later migration in this same change
-- drops them once the copy is verified.

-- H8 full-replacement (role-hierarchy rewrite): DerivedRole, the old fixed
-- admin/judge/sponsor/staff/mentor/participant/unassigned union computed by
-- guessing from capabilities/relationship tables and a stale
-- applications.type snapshot, is retired. Badge printing, wallet passes,
-- scanner UI and stats now classify a user by the badge_category of their
-- highest-position is_visible role (identity/role.ts's getEffectiveRole) —
-- but an arbitrary admin-named role ("Event Director", "Judging Coordinator")
-- still needs to render as one of a SMALL fixed set of visual/behavioral
-- buckets, hence this column. Values mirror the old DerivedRole set minus
-- 'unassigned' (unassigned is never a role property — it's what a user with
-- no visible role at all falls back to in code, see getEffectiveRole).
CREATE TYPE role_badge_category AS ENUM (
  'admin', 'judge', 'sponsor', 'staff', 'mentor', 'participant'
);

CREATE TABLE roles (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  position integer NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  is_protected boolean NOT NULL DEFAULT false,
  -- H8: true for every role inserted by a seed migration (0801's Sponsor row,
  -- every 0805 default-catalogue row) — never set by the normal POST
  -- /api/roles route, so a custom role an admin creates stays false. Durable
  -- across renames/edits (unlike matching on `name`), and used to scope the
  -- trash/restore panel to seeded roles only and to gate the "reset to
  -- default" action (role_seed_defaults, 0807).
  is_seeded boolean NOT NULL DEFAULT false,
  -- H8: the badge/wallet/scanner display-and-behavior bucket this role's
  -- holders render as (see the type comment above). Defaults to 'staff' — a
  -- freshly created custom role is treated as an operational role unless an
  -- admin says otherwise via PATCH .../capabilities' sibling role-details
  -- route.
  badge_category role_badge_category NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX roles_position_idx ON roles (position);

CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE roles IS
  'H8: the authorization truth. is_visible marks a role eligible to be shown as a user''s public role; is_protected marks a role the admin UI/API refuses to delete (e.g. the platform-administrator role created by 0801); is_seeded marks a role that came from a seed migration rather than being created by an admin.';

CREATE TYPE permission_state AS ENUM ('allow', 'deny', 'inherit');

CREATE TABLE role_capabilities (
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  capability text NOT NULL,
  state permission_state NOT NULL DEFAULT 'inherit',
  PRIMARY KEY (role_id, capability)
);

-- Mirrors 0111's group_capabilities_known_catalogue guard: the DB edge must
-- accept exactly the shared capability catalogue, nothing more. A missing
-- row for (role, capability) is implicitly INHERIT — this table only stores
-- explicit ALLOW/DENY/INHERIT rows that were set at least once.
ALTER TABLE role_capabilities
  ADD CONSTRAINT role_capabilities_known_catalogue CHECK (
    capability = ANY (
      ARRAY[
        '*',
        'users:read', 'users:write', 'permissions:manage', 'invites:manage',
        'applications:manage', 'applications:review', 'applications:decide',
        'applications:confirm-override', 'applications:edit-response',
        'projects:read', 'projects:import', 'projects:edit',
        'accredit:scan', 'presence:scan', 'activity:scan', 'logistics:stats',
        'intolerances:manage', 'queue:operate', 'queue:admin', 'judge:panel',
        'judging:export', 'sponsors:manage', 'sponsor:portal', 'challenges:manage',
        'schedule:manage', 'announcements:manage', 'tv:control', 'notifications:send',
        'audit:read', 'exports:run', 'event:manage', 'venue:manage', 'wallet:manage',
        'presence:manage'
      ]::text[]
    )
  );

CREATE TABLE user_roles (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by integer REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  -- 'manual' (an admin assigned it) or a role_grant_rules.trigger_event value
  -- (an automatic grant — e.g. 'sponsor.enterprise_linked').
  source text NOT NULL DEFAULT 'manual',
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_id_idx ON user_roles (role_id);

-- DELTA(H11): each application form can grant zero or more roles alongside
-- its existing ticket-issuing behavior on confirmation. A join table rather
-- than a single FK column, so a form can configure any number of roles.
CREATE TABLE application_grants_roles (
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES roles(id),
  PRIMARY KEY (application_id, role_id)
);

COMMENT ON TABLE application_grants_roles IS
  'H8/H11: roles granted to the applicant on confirmation, in addition to ticket issuance. No rows for a form grants nothing.';

-- Generic automatic role grant/revoke rules, decoupled from any specific
-- domain trigger. `trigger_event` is an application-code-defined string
-- (e.g. 'sponsor.enterprise_linked'); apply via lib/role-grants.ts's
-- applyRoleGrantRule so every call site routes through one shared helper
-- instead of ad hoc user_roles writes.
CREATE TABLE role_grant_rules (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  trigger_event text NOT NULL,
  action text NOT NULL CHECK (action IN ('grant', 'revoke')),
  enabled boolean NOT NULL DEFAULT true
);

CREATE INDEX role_grant_rules_trigger_event_idx ON role_grant_rules (trigger_event) WHERE enabled;

-- Bulk-resolution view (H8): one row per (user_id, capability) the user is
-- currently granted, resolved over THEIR OWN assigned roles ordered by
-- position descending — the first non-inherit state per (user, capability)
-- wins, and only ALLOW survives into this view. Deliberately does not filter
-- by account_state (mirrors the old group_capabilities join it replaces,
-- which never filtered either); callers that need "active users only" join
-- against `users` themselves, same as before. lib/capabilities.ts's
-- per-request getEffectiveCapabilities uses this view plus that filter;
-- read-model queries across many users (scanner snapshot, logistics stats,
-- announcements audience, exports) join it directly instead of re-deriving
-- the tri-state chain with their own recursive CTE.
CREATE VIEW user_effective_capabilities AS
SELECT user_id, capability
  FROM (
    SELECT DISTINCT ON (ur.user_id, rc.capability)
           ur.user_id, rc.capability, rc.state
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN role_capabilities rc ON rc.role_id = r.id
     WHERE rc.state <> 'inherit'
     ORDER BY ur.user_id, rc.capability, r.position DESC
  ) resolved
 WHERE state = 'allow';

COMMENT ON VIEW user_effective_capabilities IS
  'H8: (user_id, capability) pairs currently resolving to ALLOW through the user''s own assigned-role chain. Replaces the old recursive group_capabilities join everywhere a bulk per-user capability check is needed.';

-- H8 full-replacement: one row per user who holds at least one VISIBLE role,
-- carrying that user's single highest-position visible role's badge_category
-- (and name, for callers that want both without a second query). Bulk-query
-- equivalent of identity/role.ts's getEffectiveRole, for the same reason
-- user_effective_capabilities exists alongside the per-request
-- getEffectiveCapabilities: scanner snapshot, logistics stats and
-- announcements audience classify every user in one query rather than N+1.
-- `roles.deleted_at` doesn't exist until 0804, which redefines this view the
-- same way it redefines user_effective_capabilities above to exclude
-- soft-deleted roles. A user with no visible role has no row here — callers
-- COALESCE to 'unassigned'.
CREATE VIEW user_effective_badge_category AS
SELECT DISTINCT ON (ur.user_id)
       ur.user_id, r.badge_category, r.name AS role_name
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
 WHERE r.is_visible = true
 ORDER BY ur.user_id, r.position DESC;

COMMENT ON VIEW user_effective_badge_category IS
  'H8: each user''s single highest-position visible role, reduced to its (name, badge_category) pair. No row means the user holds no visible role — treat as the ''unassigned'' badge category. Bulk equivalent of identity/role.ts''s getEffectiveRole.';
