-- 0807_role_seed_defaults.sql — DELTA(H8): snapshot of each seeded role's
-- original capability grants at seed time, so a "reset to default" action
-- can restore exactly what 0801 (Sponsor) or 0805 (the fourteen-role default
-- catalogue) originally granted, even after an admin has edited the role's
-- live role_capabilities and/or renamed it.
--
-- `capabilities` stores only the ALLOW set as {capability: "allow"} pairs:
-- 0801/0805 seed every default role using ALLOW-only grants (the finalized
-- catalogue's "prefer ALLOW + implicit INHERIT" convention — no DENY rows
-- ever appear in either migration), so a capability absent from the
-- snapshot is implicitly INHERIT, matching what a truly fresh seed would
-- look like with no explicit row. A role with no ALLOWs at all (Sponsor,
-- Mentor, Participant) gets an empty object, not a missing row: it still
-- has a snapshot, so drift can be detected as "capabilities were added"
-- rather than the role no-oping the diff endpoint entirely.
CREATE TABLE role_seed_defaults (
  role_id integer PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
  capabilities jsonb NOT NULL
);

COMMENT ON TABLE role_seed_defaults IS
  'H8: one row per is_seeded role, capturing exactly the ALLOW capability set it was seeded with (0801 Sponsor, 0805 default catalogue). Used by GET /api/roles/:roleId/seed-diff and POST /api/roles/:roleId/reset-to-default to compute/undo drift from live role_capabilities.';

INSERT INTO role_seed_defaults (role_id, capabilities)
SELECT r.id,
       COALESCE(
         (SELECT jsonb_object_agg(rc.capability, to_jsonb(rc.state))
            FROM role_capabilities rc
           WHERE rc.role_id = r.id AND rc.state = 'allow'),
         '{}'::jsonb
       )
  FROM roles r
 WHERE r.is_seeded;
