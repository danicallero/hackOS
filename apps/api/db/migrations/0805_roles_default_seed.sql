-- 0805_roles_default_seed.sql — DELTA(H8): the finalized default role
-- catalogue for a fresh install, replacing the earlier six-role planning-to-
-- operations draft entirely. Roles here are deliberately COMPOSABLE: an
-- organizer normally holds `Organizer` plus whichever functional team
-- role(s) match their job, rather than a single ladder rung. 0801 already
-- always creates the capability-less `Sponsor` auto-grant role (see below);
-- this migration owns everything else in the fresh-install default set.
--
--   Event Director        — every catalogue capability except the admin
--                            wildcard (`*`, CLI-only, see system:superadmin)
--                            and the deprecated `sponsor:portal` no-op. The
--                            single top non-superadmin tier; sole default
--                            owner of decide/override/broadcast-type actions
--                            (applications:decide, applications:confirm-
--                            override, notifications:send) that finalize an
--                            outcome or send outward comms on someone else's
--                            behalf.
--   Organizer              — baseline held by every year-round organizer:
--                            read/scan-type visibility across applications,
--                            projects, and day-of logistics. Composes with
--                            every functional team role below.
--   Day Staff              — temporary/on-the-day staff: day-of scanning and
--                            aggregate stats only, substantially less than
--                            Organizer, and deliberately NO application
--                            response/review access (unlike Organizer).
--   Applications Team      — builds and reviews application forms.
--   Applications Lead      — decides/accepts and edits responses; sits above
--                            Applications Team. `applications:confirm-
--                            override` stays Event-Director-only, not here.
--   Operations Team        — day-of scan console plus the automatic-presence
--                            policy, food-intolerance dictionary, and venue
--                            details.
--   Hacker Experience      — programme/schedule/TV plus sponsor challenge
--                            management (challenges:manage, shared with
--                            Sponsors Team below).
--   Sponsors Team          — INTERNAL organizers who run the sponsor
--                            relationship (sponsors:manage) and manage
--                            challenges (challenges:manage) — distinct from
--                            the EXTERNAL `Sponsor` role below, which is a
--                            company representative, not an organizer.
--   Judging Team           — runs the judging floor: project visibility,
--                            queue operation, and the judging panel.
--   Judging Coordinator    — queue administration and results export; sits
--                            above Judging Team.
--   Media / Comms          — schedule, public announcements, and TV control.
--                            `notifications:send` stays Event-Director-only.
--   Technical Team         — user administration and audit access for
--                            hackOS developers. Explicitly NOT `*`,
--                            permissions:manage, wallet:manage, or
--                            event:manage.
--   Mentor                 — applicant-facing granted role (applications
--                            .grants_role_id target) for accepted mentors;
--                            carries no capabilities today. Mentor-facing
--                            features (public mentor profiles, participants
--                            asking a mentor for help) are future work, not
--                            yet built or scheduled — don't grant access
--                            ahead of the feature that would need it.
--   Participant            — applicant-facing granted role for accepted
--                            participants; carries no capabilities, same
--                            pattern as `Sponsor` — a relationship/status
--                            marker, not a permission grant.
--
-- The EXTERNAL `Sponsor` role (0801, unchanged by this migration) also
-- carries zero capabilities: investigation of sponsors/access.ts and
-- challenges/access.ts found that every one of "view my enterprise",
-- "view/manage my challenges", and "view projects submitted to my
-- challenges" already falls back to a relationship check (`ownsEnterprise`/
-- `ownsChallenge`/the sponsor branch of `resolveRepositoryAccessScope`)
-- ALONGSIDE the capability check, so granting `sponsors:manage`,
-- `projects:read`, or `challenges:manage` to every sponsor rep would be
-- broader than needed, not narrower. See docs/access-control-audit-plan.md
-- for the full investigation, including the one real gap it found (queue
-- call-next has no ownership fallback at all, by deliberate design — see the
-- doc for why that stays a documented gap here rather than a route change).
--
-- All fifteen roles below are is_protected = false and fully deletable/
-- editable via the normal roles API (H8 requirement: only system:superadmin
-- is CLI-only). Positions: Event Director sits at the top of the non-
-- superadmin hierarchy; Applications Lead/Judging Coordinator sit above
-- their respective Team roles per the composability model; Organizer is a
-- broadly-held low/mid baseline; Day Staff sits below Organizer (a smaller
-- grant); Mentor/Participant keep their prior relative order above/below the
-- unchanged Sponsor role (position 1000 from 0801). Since capabilities here
-- are additive ALLOW-only grants across largely disjoint domains, exact
-- relative position among the functional team roles is not load-bearing for
-- composability — only the three explicitly-ordered pairs above matter.

INSERT INTO roles (name, position, is_visible, is_protected) VALUES
  ('Event Director',      18700, true, false),
  ('Judging Coordinator',  8200, true, false),
  ('Applications Lead',    8100, true, false),
  ('Judging Team',         8000, true, false),
  ('Applications Team',    7900, true, false),
  ('Operations Team',      7800, true, false),
  ('Hacker Experience',    7700, true, false),
  ('Sponsors Team',        7600, true, false),
  ('Media / Comms',        7500, true, false),
  ('Technical Team',       7400, true, false),
  ('Organizer',            5000, true, false),
  ('Day Staff',            4000, true, false),
  ('Mentor',               1500, true, false),
  ('Participant',           500, true, false);

INSERT INTO role_capabilities (role_id, capability, state)
SELECT r.id, cap, 'allow'::permission_state
FROM roles r
JOIN (VALUES
  ('Event Director', ARRAY[
    'users:read','users:write','permissions:manage','invites:manage',
    'applications:manage','applications:review','applications:decide',
    'applications:confirm-override','applications:edit-response',
    'projects:read','projects:import','projects:edit',
    'accredit:scan','presence:scan','activity:scan','logistics:stats','intolerances:manage',
    'queue:operate','queue:admin','judge:panel','judging:export',
    'sponsors:manage','challenges:manage',
    'schedule:manage','announcements:manage','tv:control',
    'event:manage','venue:manage','wallet:manage','presence:manage',
    'notifications:send','audit:read','exports:run'
  ]),
  ('Organizer',           ARRAY['users:read','applications:review','projects:read','accredit:scan','presence:scan','activity:scan','logistics:stats']),
  ('Day Staff',           ARRAY['accredit:scan','presence:scan','activity:scan','logistics:stats']),
  ('Applications Team',   ARRAY['applications:manage','applications:review']),
  ('Applications Lead',   ARRAY['applications:decide','applications:edit-response']),
  ('Operations Team',     ARRAY['accredit:scan','presence:scan','activity:scan','logistics:stats','intolerances:manage','venue:manage','presence:manage']),
  ('Hacker Experience',   ARRAY['projects:read','activity:scan','schedule:manage','tv:control','challenges:manage']),
  ('Sponsors Team',       ARRAY['sponsors:manage','challenges:manage']),
  ('Judging Team',        ARRAY['projects:read','projects:import','projects:edit','queue:operate','judge:panel']),
  ('Judging Coordinator', ARRAY['queue:admin','judging:export']),
  ('Media / Comms',       ARRAY['schedule:manage','announcements:manage','tv:control']),
  ('Technical Team',      ARRAY['users:read','users:write','audit:read'])
  -- Mentor, Participant deliberately have no ALLOW rows: both are pure
  -- product/identity status markers today (same as the existing Sponsor
  -- role). Mentor-facing capabilities (e.g. project visibility for public
  -- mentor profiles, "ask a mentor for help") are future work, not yet
  -- built or scheduled — don't grant access ahead of the feature that
  -- needs it.
) AS defaults(role_name, capabilities) ON defaults.role_name = r.name
CROSS JOIN LATERAL unnest(defaults.capabilities) AS cap;
