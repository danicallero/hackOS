-- 0813_functional_roles_not_visible.sql — DELTA(H8): correct the default
-- role catalogue's `is_visible` values.
--
-- 0805 (already merged/shipped to production — this repo's migrations are
-- immutable once applied anywhere real, so the fix lands here as a new
-- migration rather than an edit to 0805) marked all fifteen fresh-install
-- default roles `is_visible = true`. That is wrong for the ten purely
-- internal/functional team roles below: an admin holding one of these for
-- capability purposes should NOT have it shown as their public "badge"
-- identity — that's what `is_visible` controls (see identity/role.ts's
-- getEffectiveRole/getHighestVisibleRoleName and the bulk
-- user_effective_role_name view, both of which already filter on
-- `is_visible = true` and just need the underlying data corrected).
--
-- Concrete effect: a user holding both "Event Director" and "Organizer" now
-- resolves to "Organizer" everywhere a single role label is shown (ticket/
-- wallet display, the /users list and filter, their own account display) —
-- Event Director becomes non-visible, so Organizer (the next-highest
-- position role they hold that IS visible) wins.
--
-- Stays is_visible = true (legitimately public-facing/base identity roles,
-- unchanged by this migration): Organizer, Day Staff, Mentor, Participant
-- (all 0805), and Sponsor (0801, not touched by 0805 or here).
--
-- Becomes is_visible = false (internal functional/team roles): Event
-- Director, Judging Coordinator, Applications Lead, Judging Team,
-- Applications Team, Operations Team, Hacker Experience, Sponsors Team,
-- Media / Comms, Technical Team.
UPDATE roles
   SET is_visible = false
 WHERE name IN (
   'Event Director',
   'Judging Coordinator',
   'Applications Lead',
   'Judging Team',
   'Applications Team',
   'Operations Team',
   'Hacker Experience',
   'Sponsors Team',
   'Media / Comms',
   'Technical Team'
 )
   AND is_seeded = true;
