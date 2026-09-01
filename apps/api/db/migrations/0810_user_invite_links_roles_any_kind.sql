-- 0810_user_invite_links_roles_any_kind.sql — DELTA(H8, H9, H10): the web
-- invite flow no longer makes the admin pick an "account type" before
-- pre-assigning roles (0113's original design assumed only a staff link
-- could carry group_ids). Any reusable invite link kind can now carry
-- pre-assigned roles — a sponsor rep can also hold a staff-side role, a
-- participant link can pre-assign a role instead of relying solely on the
-- application form's confirm-time grant. A bare staff-derived link (no
-- enterprise, no closed-form bypass) still requires at least one role —
-- enforced in the route handler, since that's the only thing such a link is
-- for — but that is no longer a database-level invariant.

ALTER TABLE user_invite_links
  DROP CONSTRAINT user_invite_links_check1;
