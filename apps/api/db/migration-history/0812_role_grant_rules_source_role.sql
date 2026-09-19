-- 0812_role_grant_rules_source_role.sql — DELTA(H8): role_grant_rules gains a
-- second, mutually-exclusive trigger kind. Until now a rule fired off a
-- fixed, developer-defined `trigger_event` string (sponsor/judge enterprise
-- events). The repo owner asked for a rule of the shape "assigning role X to
-- a user also grants role Y" — here the "event" IS an admin-chosen role, not
-- a fixed string, so it doesn't fit the existing trigger_event vocabulary
-- model (packages/shared/src/role-grant-triggers.ts stays exactly as-is;
-- this is a parallel matching key, not a new entry in that registry).
--
-- `source_role_id` is that second key: a rule with source_role_id set fires
-- when that role is assigned to (action = 'grant') or removed from
-- (action = 'revoke') a user, instead of on a domain trigger_event. Exactly
-- one of trigger_event/source_role_id is set per row — enforced by the CHECK
-- below — so the existing domain-trigger rules (and the routes/UI that only
-- ever read trigger_event) are completely unaffected; role-grants.ts gains a
-- second entry point (applyRoleAssignmentGrantRules /
-- applyRoleAssignmentRevokeRules) that queries this same table by
-- source_role_id instead of trigger_event, called from
-- identity/routes/roles.ts's POST/DELETE .../users/:userId.
--
-- Self-reference (source_role_id = role_id) is rejected outright — a role
-- can't imply itself. Longer cycles (A implies B implies A) are NOT
-- something a CHECK constraint can express (the graph is built from
-- multiple rows), so those are caught at rule-creation time by a
-- reachability check in application code (role-grant-rules.ts) instead.
ALTER TABLE role_grant_rules
  ALTER COLUMN trigger_event DROP NOT NULL,
  ADD COLUMN source_role_id integer REFERENCES roles(id) ON DELETE CASCADE;

ALTER TABLE role_grant_rules
  ADD CONSTRAINT role_grant_rules_trigger_xor_source_role CHECK (
    (trigger_event IS NOT NULL AND source_role_id IS NULL) OR
    (trigger_event IS NULL AND source_role_id IS NOT NULL)
  ),
  ADD CONSTRAINT role_grant_rules_source_role_not_self CHECK (
    source_role_id IS NULL OR source_role_id <> role_id
  );

CREATE INDEX role_grant_rules_source_role_id_idx ON role_grant_rules (source_role_id)
  WHERE enabled;

COMMENT ON COLUMN role_grant_rules.source_role_id IS
  'H8: alternative to trigger_event — a rule fires when THIS role is assigned (action=grant) or removed (action=revoke) from a user, instead of on a domain trigger_event. Exactly one of the two columns is set. See identity/role-grants.ts applyRoleAssignmentGrantRules/applyRoleAssignmentRevokeRules.';

-- Seed the exact mapping the repo owner asked for: holding any one of these
-- ten functional/leadership roles also resolves the baseline Organizer role
-- (0805's default catalogue), configured as admin-editable data rather than
-- hardcoded logic — an admin can freely retarget or delete any of these ten
-- rows later, same as any other rule. Only applies if both roles exist
-- (a fresh install without 0805's seed, or one where these were renamed,
-- silently seeds nothing here rather than failing the migration).
INSERT INTO role_grant_rules (role_id, source_role_id, action, enabled)
SELECT organizer.id, source.id, 'grant', true
FROM roles organizer
JOIN roles source ON source.name IN (
  'Event Director', 'Judging Coordinator', 'Applications Lead', 'Judging Team',
  'Applications Team', 'Operations Team', 'Hacker Experience', 'Sponsors Team',
  'Media / Comms', 'Technical Team'
)
WHERE organizer.name = 'Organizer';
