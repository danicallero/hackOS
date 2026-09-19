-- 0303_project_membership_invites.sql — participant self-service project
-- membership: invite/accept/decline, edit, leave, delete (H19, H20).

-- DELTA(H19,H20): product decision (recorded in docs/challenges-devpost.md,
-- NOT in plan/historias-hackos.md — plan/ stays read-only and normative, and
-- literally says H20 is read-only) supersedes H20's read-only participant
-- surface: while the H19 policy is enabled, participants get full
-- self-service on their own project (edit metadata, invite/accept/decline
-- teammates, leave, delete as last member), all gated by an "admitted
-- participant" eligibility check and a hacking-window time gate.
--
-- `submissions` already carries `created_at` (doubles as "invited/joined
-- at"); this adds the invite lifecycle on top. A row starts 'active' by
-- default so every existing/organization-added membership (H18, H21) needs
-- no backfill. An 'invited' row is a pending invite: accepting flips it to
-- 'active' and stamps responded_at; declining deletes the row outright.
-- Devpost-linked members (`devpost_participants` with `user_id` set) are
-- already full members and need no status of their own.
ALTER TABLE submissions
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active')),
  ADD COLUMN invited_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN responded_at timestamptz;
