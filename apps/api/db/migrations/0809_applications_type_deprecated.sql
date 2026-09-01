-- 0809_applications_type_deprecated.sql — DELTA(H8/H11): applications.type
-- retired as a semantic driver. Whether a form is "a participant/mentor/
-- sponsor/volunteer application" used to be answered by this separately-set
-- static classification, which nothing kept in sync with what the form
-- actually granted on confirmation (`application_grants_roles`, H8) — a form
-- could be typed 'participant' while actually granting the Mentor role, or
-- vice versa. The real, drift-proof answer is now always "which role(s) does
-- this form grant" (application_grants_roles joined to roles.badge_category,
-- the same durable per-role classification identity/role.ts already uses for
-- badge/wallet/scanner display — see 0800_roles_schema.sql).
--
-- The column is kept (nullable) purely so existing rows' historical value is
-- still inspectable — it is never written by the API anymore (create/update
-- no longer accept `type`) and nothing reads it as authoritative.
ALTER TABLE applications ALTER COLUMN type DROP NOT NULL;

COMMENT ON COLUMN applications.type IS
  'DEPRECATED (H8): legacy static classification, no longer set by the API or read as authoritative for any behavior. See application_grants_roles + roles.badge_category (granted_badge_category in admin.routes.ts COLUMNS) for the real, drift-proof classification.';
