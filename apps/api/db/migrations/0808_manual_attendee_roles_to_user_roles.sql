-- 0808_manual_attendee_roles_to_user_roles.sql — DELTA(H8/H10): the
-- role-hierarchy full-replacement retires DerivedRole's applications.type
-- guess entirely (identity/role.ts), but manual_attendee_roles was never a
-- guess — it's an explicit, staff-driven classification (H10's manual
-- account creation, PUT /api/users/:id/attendee-role, and accreditation's
-- walk-in classification). That's exactly what the seeded Mentor/Participant
-- roles (0805) are for, so every write path for manual_attendee_roles now
-- grants the matching real role instead (code change, identity/routes/
-- profile.ts + logistics/accreditation.ts). This migration backfills every
-- EXISTING manual_attendee_roles row onto the equivalent user_roles grant so
-- an account classified before this cutover doesn't lose its badge/wallet/
-- scanner category the moment this ships. manual_attendee_roles itself is
-- NOT dropped — see role.ts's hasEventAccess/getBadgeCategory doc comment
-- for why a couple of read paths still reference it defensively.
INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at, source)
SELECT mar.user_id, r.id, mar.assigned_by, mar.assigned_at, 'manual_attendee_roles_migration'
  FROM manual_attendee_roles mar
  JOIN roles r ON r.name = initcap(mar.role) AND r.is_seeded = true AND r.deleted_at IS NULL
ON CONFLICT (user_id, role_id) DO NOTHING;
