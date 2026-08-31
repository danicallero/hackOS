-- 0805_roles_default_seed.sql — DELTA(H8): a realistic default role set for a
-- typical event's staff structure, from planning through operations, plus
-- default roles for applications and sponsors. 0801 already seeded the 20
-- H8 platform templates (Access administrator, Application
-- builder/reviewer/decisions/supervisor, Judging administrator, Queue
-- operator, the station roles, Programme manager, Event settings manager,
-- etc.) plus the capability-less `Sponsor` auto-grant role — this migration
-- adds the roles that gap analysis of a real hackathon's org chart still
-- needs, without duplicating any of those:
--
--   Event director     — planning/organization: owns event identity, venue,
--                         programme, and outward comms end-to-end (a level
--                         above the narrower Event settings manager /
--                         Programme manager / Communications manager, who
--                         each own one slice); as the top non-superadmin
--                         planning tier it's also the sole default owner of
--                         the applications decide/override actions (see the
--                         risk-tiering note below).
--   Judge coordinator   — judging floor coordination (judge:panel,
--                         projects:read, applications:review) without Judging
--                         administrator's queue:operate/queue:admin/
--                         judging:export authority.
--   Operations lead     — day-of ops decision-maker: logistics visibility,
--                         the automatic-presence policy, queue:admin, and
--                         day-of activity/meal scanning, distinct from
--                         Logistics supervisor's scan-console duties and from
--                         Queue operator's call/skip console.
--   Volunteer staff     — lightweight check-in-desk staffing: both entry
--                         scans (accredit + presence), no stats/logistics
--                         visibility — a genuinely smaller grant than
--                         Logistics supervisor or either single-scan station
--                         role.
--   Mentor              — applicant-facing granted role (applications
--                         .grants_role_id target) for accepted mentors:
--                         read-only project visibility, nothing to manage.
--   Participant         — applicant-facing granted role for accepted
--                         participants; carries no capabilities of its own,
--                         same pattern as the existing Sponsor role — it is
--                         a relationship/status marker, not a permission
--                         grant. Distinct from the Application
--                         reviewer/administrator roles, which belong to
--                         STAFF who run the review process, not applicants.
--
-- All six are is_protected = false and fully deletable/editable via the
-- normal roles API (H8 requirement: only system:superadmin is CLI-only).
-- Positions slot into the existing hierarchy: Event director just under
-- Platform administrator; Judge coordinator/Operations lead within the
-- operations band; Volunteer staff below the station roles; Mentor above
-- Sponsor; Participant at the very bottom, below Sponsor.
--
-- Risk-tiering principle applied to these capability sets: read/score/scan/
-- stats-type capabilities (applications:review, activity:scan,
-- logistics:stats, projects:read, users:read) are broad and non-destructive,
-- so they're granted to whichever role's domain they match. Decide/override/
-- broadcast-type capabilities (applications:decide,
-- applications:confirm-override, announcements:manage, notifications:send)
-- send outward communication or finalize outcomes on someone else's behalf —
-- those are concentrated at Event director, the single top non-superadmin
-- tier, rather than spread across every operational role that touches the
-- adjacent read-only capability. Concretely: Judge coordinator gets
-- applications:review (scoring is squarely judging-coordination) but not
-- applications:decide; Operations lead gets activity:scan (day-of scanning)
-- but no applications or comms capability at all — applications aren't its
-- domain, and a broadcast capability there would be excess authority for an
-- operational console role.

INSERT INTO roles (name, position, is_visible, is_protected) VALUES
  ('Event director',   18700, true, false),
  ('Judge coordinator', 16800, true, false),
  ('Operations lead',  16700, true, false),
  ('Volunteer staff',  15150, true, false),
  ('Mentor',            1500, true, false),
  ('Participant',        500, true, false);

INSERT INTO role_capabilities (role_id, capability, state)
SELECT r.id, cap, 'allow'::permission_state
FROM roles r
JOIN (VALUES
  ('Event director',    ARRAY['event:manage','venue:manage','schedule:manage','announcements:manage','users:read','applications:review','applications:decide','applications:confirm-override']),
  ('Judge coordinator',  ARRAY['judge:panel','projects:read','applications:review']),
  ('Operations lead',   ARRAY['queue:admin','logistics:stats','presence:manage','activity:scan']),
  ('Volunteer staff',   ARRAY['accredit:scan','presence:scan']),
  ('Mentor',            ARRAY['projects:read'])
  -- Participant deliberately carries no capability rows (same as Sponsor):
  -- it is a status marker for applications.grants_role_id, not a grant.
) AS defaults(role_name, capabilities) ON defaults.role_name = r.name
CROSS JOIN LATERAL unnest(defaults.capabilities) AS cap;
